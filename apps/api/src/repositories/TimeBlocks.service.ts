import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { signalAgendaChanged } from '../infra/live-signals.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { requireBusinessPermission, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import { blocksSeenBy, calendarMembershipWhere, validateCalendarScope, type CalendarScope } from '../security/calendar-scope.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { withBusinessConfiguration } from './publication.js';
import { fenceScheduleSession } from './ScheduleImpact.service.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { BusinessPermission } from '../security/business-permissions.js';

export const BLOCK_CONFLICT = 'BLOCK_CONFLICT';
export const MAX_BLOCK_DAYS = 366;
export const MAX_LISTED_BLOCKS = 200;
export const MAX_REPORTED_CONFLICTS = 20;
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
// Without staffId a block covers the whole business. The agenda's original payload has no kind and means hours.
const target = { businessId: z.string().min(1).optional(), staffId: z.string().min(1).optional(), reason: z.string().trim().max(200).optional() };
export const timeBlockSchema = z.union([
  z.strictObject({ ...target, kind: z.literal('hours').optional(), date: z.string().date(), startLocal: time, endLocal: time }),
  z.strictObject({ ...target, kind: z.literal('days'), fromDate: z.string().date(), toDate: z.string().date() }),
]);
export type TimeBlockInput = z.infer<typeof timeBlockSchema>;

const midnight = (date: Temporal.PlainDate, timezone: string) => new Date(Number(date.toZonedDateTime({ timeZone: timezone, plainTime: '00:00' }).epochMilliseconds));
function blockRange(input: TimeBlockInput, timezone: string) {
  if (input.kind === 'days') {
    const first = Temporal.PlainDate.from(input.fromDate), last = Temporal.PlainDate.from(input.toDate);
    if (Temporal.PlainDate.compare(last, first) < 0) throw new AppError(400, 'VALIDATION_ERROR', 'The last day must not come before the first day.', { toDate: 'The last day must not come before the first day.' });
    if (first.until(last).days + 1 > MAX_BLOCK_DAYS) throw new AppError(400, 'VALIDATION_ERROR', `Block at most ${MAX_BLOCK_DAYS} days at a time.`, { toDate: `Block at most ${MAX_BLOCK_DAYS} days at a time.` });
    return { startsAt: midnight(first, timezone), endsAt: midnight(last.add({ days: 1 }), timezone), allDay: true };
  }
  let startsAt: Date, endsAt: Date;
  try { startsAt = localDateTimeToInstant(input.date, input.startLocal, timezone); endsAt = localDateTimeToInstant(input.date, input.endLocal, timezone); } catch { throw new AppError(400, 'INVALID_LOCAL_TIME', 'Choose valid unambiguous local times.'); }
  if (endsAt <= startsAt) throw new AppError(400, 'VALIDATION_ERROR', 'The end must follow the start.', { endLocal: 'The end must follow the start.' });
  return { startsAt, endsAt, allDay: false };
}

// Local dates and times let clients show a block without redoing timezone arithmetic.
function presentBlock(block: { id: string; startsAt: Date; endsAt: Date; allDay: boolean; reason: string | null; staff: { id: string; displayName: string } | null }, timezone: string) {
  const start = Temporal.Instant.from(block.startsAt.toISOString()).toZonedDateTimeISO(timezone), end = Temporal.Instant.from(block.endsAt.toISOString()).toZonedDateTimeISO(timezone);
  const minute = (value: Temporal.ZonedDateTime) => value.toPlainTime().toString({ smallestUnit: 'minute' });
  return { ...block, fromDate: start.toPlainDate().toString(), toDate: (block.allDay ? end.subtract({ days: 1 }) : end).toPlainDate().toString(), ...(block.allDay ? {} : { startLocal: minute(start), endLocal: minute(end) }) };
}
export const blockProjection = { id: true, startsAt: true, endsAt: true, allDay: true, reason: true, staff: { select: { id: true, displayName: true } } } as const;
export const presentBlocks = <T extends Parameters<typeof presentBlock>[0]>(blocks: T[], timezone: string) => blocks.map(block => presentBlock(block, timezone));

export async function listTimeBlocks(scope: CalendarScope, now = new Date()) {
  await validateCalendarScope(scope, 'see');
  const { context } = scope;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
  const blocks = await prisma.timeBlock.findMany({ where: { businessId: context.businessId, endsAt: { gt: now }, ...blocksSeenBy(scope) }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: MAX_LISTED_BLOCKS, select: blockProjection });
  return { timezone: business.timezone, blocks: presentBlocks(blocks, business.timezone) };
}

async function blockConflicts(tx: Prisma.TransactionClient, businessId: string, staffId: string | undefined, startsAt: Date, endsAt: Date, now: Date) {
  // Appointments already over stay where they are; only current and future work is protected.
  const where = { businessId, ...(staffId ? { staffId } : {}), occupiedFrom: { lt: endsAt }, occupiedUntil: { gt: startsAt < now ? now : startsAt }, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const } }, { status: 'HELD' as const, holdExpiresAt: { gt: now } }] } satisfies Prisma.BookingWhereInput;
  const [total, rows] = await Promise.all([
    tx.booking.count({ where }),
    tx.booking.findMany({ where, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: MAX_REPORTED_CONFLICTS, select: { id: true, status: true, startsAt: true, endsAt: true, customerName: true, serviceName: true, staff: { select: { displayName: true } } } }),
  ]);
  // A reservation in progress belongs to a customer who has not booked yet, so it carries no customer details.
  return { total, conflicts: rows.map(row => row.status === 'HELD' ? { kind: 'RESERVATION' as const, startsAt: row.startsAt, endsAt: row.endsAt, staffName: row.staff.displayName } : { kind: 'APPOINTMENT' as const, id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, staffName: row.staff.displayName, customerName: row.customerName, serviceName: row.serviceName }) };
}

/** Signals open agendas once a business configuration change has committed. */
export async function changingAgenda<T>(context: AuthorizedBusinessContext, work: Parameters<typeof withBusinessConfiguration<T>>[1], permission: BusinessPermission = BusinessPermission.BUSINESS_SETUP) {
  const result = await withBusinessConfiguration(context, work, permission);
  signalAgendaChanged(context.businessId);
  return result;
}

/**
 * The context a block change runs under, and the permission its configuration lock rechecks. A block on one row is
 * calendar work: every calendar, or the worker's own row only. A block without a row closes the whole business, so it
 * is business setup too (decisions.md, "My day for a worker").
 */
async function blockAuthority(scope: CalendarScope, staffId: string | null) {
  await validateCalendarScope(scope, 'act');
  if (staffId === null) {
    if (scope.staffId) throw forbidden();
    return { context: await requireBusinessPermission(scope.context.identityId, scope.context.businessId, BusinessPermission.BUSINESS_SETUP), permission: BusinessPermission.BUSINESS_SETUP };
  }
  if (scope.staffId && scope.staffId !== staffId) throw notFound();
  return { context: scope.context, permission: scope.staffId ? BusinessPermission.OWN_CALENDAR : BusinessPermission.ACT_ON_ALL_CALENDARS };
}
/** Inside the lock: the member still works this calendar (a worker relinked meanwhile is refused). */
async function assertStillActing(tx: Prisma.TransactionClient, scope: CalendarScope) {
  if (scope.staffId && !await tx.membership.findFirst({ where: calendarMembershipWhere(scope, 'act'), select: { id: true } })) throw notFound();
}

export async function createTimeBlock(scope: CalendarScope, input: TimeBlockInput, session: AuthenticatedSession, now = new Date()) {
  const { context, permission } = await blockAuthority(scope, input.staffId ?? null);
  return changingAgenda(context, async tx => {
    await fenceScheduleSession(tx, session);
    await assertStillActing(tx, scope);
    if (input.staffId && !await tx.staff.findFirst({ where: { businessId: context.businessId, id: input.staffId, active: true }, select: { id: true } })) throw notFound();
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
    const range = blockRange(input, business.timezone);
    if (range.endsAt <= now) throw new AppError(400, 'BLOCK_IN_PAST', 'This time has already passed.');
    const { total, conflicts } = await blockConflicts(tx, context.businessId, input.staffId, range.startsAt, range.endsAt, now);
    // Overlapping another block is harmless, so only appointments and reservations refuse a block.
    if (total) throw new AppError(409, BLOCK_CONFLICT, 'This block overlaps appointments or reservations. Move or cancel them first.', undefined, { total, conflicts });
    const block = await tx.timeBlock.create({ data: { businessId: context.businessId, staffId: input.staffId ?? null, ...range, reason: input.reason || null }, select: blockProjection });
    return presentBlock(block, business.timezone);
  }, permission);
}

/** A worker releases only their own row's blocks; a business-wide one they can see reads as not found. */
export async function deleteTimeBlock(scope: CalendarScope, id: string, session: AuthenticatedSession) {
  const block = await prisma.timeBlock.findFirst({ where: { id, businessId: scope.context.businessId, ...(scope.staffId ? { staffId: scope.staffId } : {}) }, select: { staffId: true } });
  if (!block) throw notFound();
  const { context, permission } = await blockAuthority(scope, block.staffId);
  return changingAgenda(context, async tx => {
    await fenceScheduleSession(tx, session);
    await assertStillActing(tx, scope);
    // The row it was read with: a block cannot change rows, so a mismatch means it is gone.
    if (!(await tx.timeBlock.deleteMany({ where: { id, businessId: context.businessId, staffId: block.staffId } })).count) throw notFound();
    return { deleted: true };
  }, permission);
}

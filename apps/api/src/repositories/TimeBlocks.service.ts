import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, notFound } from '../http/errors.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { withBusinessConfiguration } from './publication.js';
import { fenceScheduleSession } from './ScheduleImpact.service.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';

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

export async function listTimeBlocks(context: AuthorizedBusinessContext, now = new Date()) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
  const blocks = await prisma.timeBlock.findMany({ where: { businessId: context.businessId, endsAt: { gt: now } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: MAX_LISTED_BLOCKS, select: blockProjection });
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

export async function createTimeBlock(context: AuthorizedBusinessContext, input: TimeBlockInput, session: AuthenticatedSession, now = new Date()) {
  return withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    if (input.staffId && !await tx.staff.findFirst({ where: { businessId: context.businessId, id: input.staffId, active: true }, select: { id: true } })) throw notFound();
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
    const range = blockRange(input, business.timezone);
    if (range.endsAt <= now) throw new AppError(400, 'BLOCK_IN_PAST', 'This time has already passed.');
    const { total, conflicts } = await blockConflicts(tx, context.businessId, input.staffId, range.startsAt, range.endsAt, now);
    // Overlapping another block is harmless, so only appointments and reservations refuse a block.
    if (total) throw new AppError(409, BLOCK_CONFLICT, 'This block overlaps appointments or reservations. Move or cancel them first.', undefined, { total, conflicts });
    const block = await tx.timeBlock.create({ data: { businessId: context.businessId, staffId: input.staffId ?? null, ...range, reason: input.reason || null }, select: blockProjection });
    return presentBlock(block, business.timezone);
  });
}

export async function deleteTimeBlock(context: AuthorizedBusinessContext, id: string, session: AuthenticatedSession) {
  return withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    if (!(await tx.timeBlock.deleteMany({ where: { id, businessId: context.businessId } })).count) throw notFound();
    return { deleted: true };
  });
}

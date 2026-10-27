import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, notFound, unauthenticated } from '../http/errors.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { lockBusinessConfiguration } from './publication.js';
import { parseAvailabilityRules, effectiveWindows } from '../scheduling/rules.js';
import { containsInterval, workingWindows } from '../scheduling/availability.js';
import type { AvailabilityRules } from './provider-settings.js';
export async function fenceScheduleSession(tx: Prisma.TransactionClient, session?: AuthenticatedSession) {
  if (!session) return;
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.sessionId} FOR SHARE`;
  if (!await tx.session.findFirst({ where: { id: session.sessionId, identityId: session.identity.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) throw unauthenticated();
}
export async function scheduleImpact(tx: Prisma.TransactionClient, businessId: string, proposal: AvailabilityRules, staffId?: string) {
  const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true, updatedAt: true, weeklyAvailability: { orderBy: { id: 'asc' } }, scheduleOverrides: { orderBy: { id: 'asc' } } } });
  const staff = await tx.staff.findMany({ where: { businessId }, orderBy: { id: 'asc' }, select: { id: true, displayName: true, availability: { orderBy: { id: 'asc' } }, overrides: { orderBy: { id: 'asc' } } } });
  if (staffId && !staff.some(item => item.id === staffId)) throw notFound();
  const bookings = await tx.booking.findMany({ where: { businessId, ...(staffId ? { staffId } : {}), occupiedUntil: { gt: new Date() }, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true, staffId: true, startsAt: true, endsAt: true, occupiedFrom: true, occupiedUntil: true, status: true, revision: true, serviceName: true } });
  const proposedWeekly = proposal.weekly.flatMap(day => day.intervals.map(interval => ({ ...interval, weekday: day.weekday })));
  const proposedOverrides = proposal.overrides.map(day => ({ ...day, date: new Date(`${day.date}T00:00:00Z`), startLocal: day.startLocal ?? null, endLocal: day.endLocal ?? null }));
  const affected = bookings.filter(booking => {
    const resource = staff.find(item => item.id === booking.staffId);
    if (!resource) return true;
    const day = Temporal.Instant.from(booking.startsAt.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
    const key = day.toString(), weekday = day.dayOfWeek % 7;
    const businessWeekly = staffId ? business.weeklyAvailability : proposedWeekly, businessOverrides = staffId ? business.scheduleOverrides : proposedOverrides;
    const staffWeekly = staffId === resource.id ? proposedWeekly : resource.availability, staffOverrides = staffId === resource.id ? proposedOverrides : resource.overrides;
    const hours = effectiveWindows(businessOverrides.find(row => row.date.toISOString().slice(0, 10) === key) ?? null, businessWeekly.filter(row => row.weekday === weekday));
    const resourceHours = effectiveWindows(staffOverrides.find(row => row.date.toISOString().slice(0, 10) === key) ?? null, staffWeekly.length ? staffWeekly.filter(row => row.weekday === weekday) : hours);
    return !containsInterval(workingWindows(key, business.timezone, hours, resourceHours).intervals, { startsAt: booking.occupiedFrom, endsAt: booking.occupiedUntil });
  }).map(booking => ({ id: booking.id, revision: booking.revision, status: booking.status, startsAt: booking.startsAt, endsAt: booking.endsAt, serviceName: booking.serviceName, staffName: staff.find(item => item.id === booking.staffId)?.displayName ?? '' }));
  const token = createHash('sha256').update(JSON.stringify({ businessId, staffId, proposal, business, staff, bookings })).digest('hex');
  return { token, timezone: business.timezone, affected, canSave: !affected.length };
}
export async function assertSafeSchedule(tx: Prisma.TransactionClient, businessId: string, proposal: AvailabilityRules, staffId?: string, expectedToken?: string) {
  const impact = await scheduleImpact(tx, businessId, proposal, staffId);
  if (expectedToken && impact.token !== expectedToken) throw new AppError(409, 'SCHEDULE_CHANGED', 'The schedule or appointments changed. Preview this edit again.');
  if (!impact.canSave) throw new AppError(409, 'SCHEDULE_CONFLICT', 'This edit would invalidate appointments or active reservations. Resolve them before saving.');
}
export async function previewSchedule(context: AuthorizedBusinessContext, input: unknown, staffId?: string, session?: AuthenticatedSession) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  return prisma.$transaction(async tx => {
    await fenceScheduleSession(tx, session);
    await lockBusinessConfiguration(tx, context);
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
    return scheduleImpact(tx, context.businessId, parseAvailabilityRules(input, business.timezone), staffId);
  }, { maxWait: 5000, timeout: 15000 });
}

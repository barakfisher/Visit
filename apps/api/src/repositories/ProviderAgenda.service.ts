import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { withBusinessConfiguration } from './publication.js';
import { fenceScheduleSession } from './ScheduleImpact.service.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { bookingServiceSnapshot } from './bookings.js';
export async function readProviderAgenda(context: AuthorizedBusinessContext, date: string, days: 1 | 7) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  return prisma.$transaction(async tx => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { id: true, name: true, timezone: true } });
    const chosen = Temporal.PlainDate.from(date), first = days === 7 ? chosen.subtract({ days: chosen.dayOfWeek % 7 }) : chosen, end = first.add({ days });
    const startsAt = new Date(Number(first.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const endsAt = new Date(Number(end.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const [rows, blocks, staff] = await Promise.all([
      tx.booking.findMany({ where: { businessId: context.businessId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true, status: true, revision: true, startsAt: true, endsAt: true, source: true, manualReason: true, customerName: true, customerPhone: true, customerEmail: true, serviceId: true, serviceName: true, serviceDurationMinutes: true, servicePriceMinor: true, serviceCurrency: true, staff: { select: { displayName: true } } } }),
      tx.timeBlock.findMany({ where: { businessId: context.businessId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true, startsAt: true, endsAt: true, reason: true, staff: { select: { displayName: true } } } }),
      tx.staff.findMany({ where: { businessId: context.businessId, active: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], select: { id: true, displayName: true, parallelCapacity: true } }),
    ]);
    const revenue: Record<string, number> = {};
    for (const row of rows) if (['CONFIRMED', 'COMPLETED'].includes(row.status) && row.serviceCurrency && row.servicePriceMinor !== null) revenue[row.serviceCurrency] = (revenue[row.serviceCurrency] ?? 0) + row.servicePriceMinor;
    return { business, fromDate: first.toString(), toDate: end.subtract({ days: 1 }).toString(), staff, blocks, summary: { appointments: rows.filter(row => row.status !== 'CANCELLED').length, revenue }, bookings: rows.map(row => ({ id: row.id, source: row.source, manualReason: row.manualReason, revision: row.revision, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, customer: { displayName: row.customerName, phone: row.customerPhone, email: row.customerEmail }, service: bookingServiceSnapshot(row), staff: row.staff })) };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
}
export const timeBlockSchema = z.strictObject({ businessId: z.string().min(1).optional(), staffId: z.string().min(1), date: z.string().date(), startLocal: z.string().regex(/^\d{2}:\d{2}$/), endLocal: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().trim().max(200).optional() });
export async function createAgendaBlock(context: AuthorizedBusinessContext, input: z.infer<typeof timeBlockSchema>, session: AuthenticatedSession) {
  return withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    if (!await tx.staff.findFirst({ where: { businessId: context.businessId, id: input.staffId, active: true }, select: { id: true } })) throw notFound();
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
    let startsAt: Date, endsAt: Date;
    try { startsAt = localDateTimeToInstant(input.date, input.startLocal, business.timezone); endsAt = localDateTimeToInstant(input.date, input.endLocal, business.timezone); } catch { throw new AppError(400, 'INVALID_LOCAL_TIME', 'Choose valid unambiguous local times.'); }
    if (endsAt <= startsAt) throw new AppError(400, 'VALIDATION_ERROR', 'The end must follow the start.');
    if (await tx.booking.count({ where: { businessId: context.businessId, staffId: input.staffId, occupiedFrom: { lt: endsAt }, occupiedUntil: { gt: startsAt }, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] } }) || await tx.timeBlock.count({ where: { businessId: context.businessId, staffId: input.staffId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })) throw conflict('This break overlaps an appointment, reservation or existing break.');
    return tx.timeBlock.create({ data: { businessId: context.businessId, staffId: input.staffId, startsAt, endsAt, reason: input.reason || null } });
  });
}
export async function deleteAgendaBlock(context: AuthorizedBusinessContext, id: string, session: AuthenticatedSession) {
  return withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    if (!(await tx.timeBlock.deleteMany({ where: { id, businessId: context.businessId } })).count) throw notFound();
    return { deleted: true };
  });
}

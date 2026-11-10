import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../db/client.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import { bookingServiceSnapshot } from './bookings.js';
import { canMarkNoShow, presentedStatus } from './AppointmentOutcome.utils.js';
import { blockProjection, presentBlocks } from './TimeBlocks.service.js';
export async function readProviderAgenda(context: AuthorizedBusinessContext, date: string, days: 1 | 7) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  return prisma.$transaction(async tx => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { id: true, name: true, timezone: true } });
    const chosen = Temporal.PlainDate.from(date), first = days === 7 ? chosen.subtract({ days: chosen.dayOfWeek % 7 }) : chosen, end = first.add({ days });
    const startsAt = new Date(Number(first.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const endsAt = new Date(Number(end.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const [rows, blocks, staff] = await Promise.all([
      tx.booking.findMany({ where: { businessId: context.businessId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true, status: true, revision: true, startsAt: true, endsAt: true, source: true, manualReason: true, customerName: true, customerPhone: true, customerEmail: true, serviceId: true, serviceName: true, serviceDurationMinutes: true, servicePriceMinor: true, serviceCurrency: true, staff: { select: { displayName: true } } } }),
      tx.timeBlock.findMany({ where: { businessId: context.businessId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: blockProjection }),
      tx.staff.findMany({ where: { businessId: context.businessId, active: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], select: { id: true, displayName: true, parallelCapacity: true } }),
    ]);
    const revenue: Record<string, number> = {}, now = Date.now();
    for (const row of rows) if (['CONFIRMED', 'COMPLETED'].includes(row.status) && row.serviceCurrency && row.servicePriceMinor !== null) revenue[row.serviceCurrency] = (revenue[row.serviceCurrency] ?? 0) + row.servicePriceMinor;
    return { business, fromDate: first.toString(), toDate: end.subtract({ days: 1 }).toString(), staff, blocks: presentBlocks(blocks, business.timezone), summary: { appointments: rows.filter(row => row.status !== 'CANCELLED').length, revenue }, bookings: rows.map(row => ({ id: row.id, source: row.source, manualReason: row.manualReason, revision: row.revision, status: presentedStatus(row, now), canMarkNoShow: canMarkNoShow(row, now), startsAt: row.startsAt, endsAt: row.endsAt, customer: { displayName: row.customerName, phone: row.customerPhone, email: row.customerEmail }, service: bookingServiceSnapshot(row), staff: row.staff })) };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
}

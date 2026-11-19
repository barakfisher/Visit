import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../db/client.js';
import { blocksSeenBy, onCalendar, validateCalendarScope, type CalendarScope } from '../security/calendar-scope.js';
import { bookingServiceSnapshot } from './bookings.js';
import { canMarkNoShow, presentedStatus } from './AppointmentOutcome.utils.js';
import { blockProjection, presentBlocks } from './TimeBlocks.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { dayFreeTime, presentFreeGap } from '../scheduling/free-time.js';
import { openHours } from '../scheduling/open-hours.js';

/**
 * One day's free time and whether the business is closed, for the home's cards (decisions.md, "The business day as cards").
 * Busy time is read the way booking reads it: occupied intervals of live appointments and holds, plus blocks.
 */
async function readDayFreeTime(tx: Prisma.TransactionClient, scope: CalendarScope, timezone: string, day: Temporal.PlainDate, startsAt: Date, endsAt: Date, now: Date) {
  const businessId = scope.context.businessId;
  const weekday = day.dayOfWeek % 7;
  const [policy, businessWindows, staff] = await Promise.all([
    tx.bookingPolicy.findUnique({ where: { businessId }, select: { bufferBeforeMinutes: true, bufferAfterMinutes: true } }),
    tx.businessWeeklyAvailability.findMany({ where: { businessId, weekday }, select: { startLocal: true, endLocal: true } }),
    tx.staff.findMany({ where: { businessId, active: true, ...(scope.staffId ? { id: scope.staffId } : {}) }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], select: {
      id: true, displayName: true,
      availability: { select: { weekday: true, startLocal: true, endLocal: true } },
      services: { where: { service: { active: true } }, select: { service: { select: { durationMinutes: true } } } },
      bookings: { where: { businessId, occupiedFrom: { lt: endsAt }, occupiedUntil: { gt: startsAt }, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, { status: 'HELD', holdExpiresAt: { gt: now } }] }, select: { occupiedFrom: true, occupiedUntil: true } },
    } }),
  ]);
  const blocks = await tx.timeBlock.findMany({ where: { businessId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...blocksSeenBy(scope) }, select: { staffId: true, startsAt: true, endsAt: true } });
  const before = policy?.bufferBeforeMinutes ?? 0, after = policy?.bufferAfterMinutes ?? 0;
  const result = dayFreeTime({ date: day.toString(), timezone, now, businessWindows, staff: staff.map(row => {
    const durations = row.services.map(link => link.service.durationMinutes);
    return { id: row.id, displayName: row.displayName,
      // A staff member without hours of their own works the business's hours, as availability does.
      windows: row.availability.length ? row.availability.filter(hours => hours.weekday === weekday) : businessWindows,
      busy: [...row.bookings.map(booking => ({ startsAt: booking.occupiedFrom, endsAt: booking.occupiedUntil })), ...blocks.filter(block => block.staffId === null || block.staffId === row.id)],
      shortestMinutes: durations.length ? Math.min(...durations) + before + after : null };
  }) });
  return { closed: result.closed, free: result.free.map(gap => presentFreeGap(gap, timezone, before)) };
}
/**
 * The agenda of every calendar, or of a worker's own row only (`scope.staffId`): their appointments, their blocks and the
 * business-wide ones, their hours and free time. `calendar` is the worker's row, so My day can say when it takes no
 * new bookings; it is null for the whole business.
 */
export async function readProviderAgenda(scope: CalendarScope, date: string, days: 1 | 3 | 7, now = new Date()) {
  await validateCalendarScope(scope, 'see');
  const { context } = scope, own = onCalendar(scope);
  return prisma.$transaction(async tx => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { id: true, name: true, timezone: true } });
    // A week starts on its Sunday; a day and the calendar's three days start on the chosen date.
    const chosen = Temporal.PlainDate.from(date), first = days === 7 ? chosen.subtract({ days: chosen.dayOfWeek % 7 }) : chosen, end = first.add({ days });
    const startsAt = new Date(Number(first.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const endsAt = new Date(Number(end.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const [rows, blocks, staff] = await Promise.all([
      tx.booking.findMany({ where: { businessId: context.businessId, ...own, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true, status: true, revision: true, startsAt: true, endsAt: true, source: true, manualReason: true, customerName: true, customerPhone: true, customerEmail: true, serviceId: true, serviceName: true, serviceDurationMinutes: true, servicePriceMinor: true, serviceCurrency: true, staff: { select: { displayName: true } } } }),
      tx.timeBlock.findMany({ where: { businessId: context.businessId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...blocksSeenBy(scope) }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: blockProjection }),
      tx.staff.findMany({ where: { businessId: context.businessId, active: true, ...(scope.staffId ? { id: scope.staffId } : {}) }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], select: { id: true, displayName: true, parallelCapacity: true } }),
    ]);
    const calendar = scope.staffId ? await tx.staff.findFirst({ where: { businessId: context.businessId, id: scope.staffId }, select: { id: true, displayName: true, active: true } }) : null;
    // When each day is open, for the calendar's grid; the same reading of "closed" as the home's day cards.
    const [businessHours, staffHours] = await Promise.all([
      tx.businessWeeklyAvailability.findMany({ where: { businessId: context.businessId }, select: { weekday: true, startLocal: true, endLocal: true } }),
      tx.staff.findMany({ where: { businessId: context.businessId, active: true, ...(scope.staffId ? { id: scope.staffId } : {}) }, select: { availability: { select: { weekday: true, startLocal: true, endLocal: true } } } }),
    ]);
    const hours = openHours(Array.from({ length: days }, (_, index) => first.add({ days: index }).toString()), businessHours, staffHours.map(row => ({ windows: row.availability })));
    // Only a single day has cards; the weekly view keeps its list.
    const day = days === 1 ? await readDayFreeTime(tx, scope, business.timezone, first, startsAt, endsAt, now) : null;
    const revenue: Record<string, number> = {}, at = now.getTime();
    for (const row of rows) if (['CONFIRMED', 'COMPLETED'].includes(row.status) && row.serviceCurrency && row.servicePriceMinor !== null) revenue[row.serviceCurrency] = (revenue[row.serviceCurrency] ?? 0) + row.servicePriceMinor;
    return { business, calendar, day, hours, fromDate: first.toString(), toDate: end.subtract({ days: 1 }).toString(), staff, blocks: presentBlocks(blocks, business.timezone), summary: { appointments: rows.filter(row => row.status !== 'CANCELLED').length, revenue }, bookings: rows.map(row => ({ id: row.id, source: row.source, manualReason: row.manualReason, revision: row.revision, status: presentedStatus(row, at), canMarkNoShow: canMarkNoShow(row, at), startsAt: row.startsAt, endsAt: row.endsAt, customer: { displayName: row.customerName, phone: row.customerPhone, email: row.customerEmail }, service: bookingServiceSnapshot(row), staff: row.staff })) };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
}

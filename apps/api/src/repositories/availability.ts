import { publicBusinessWhere } from '../security/business-eligibility.js';
import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { validatePublicBusinessContext, type PublicBusinessContext } from '../security/tenant-context.js';
import { generateAvailability } from '../scheduling/availability.js';
import { effectiveWindows } from '../scheduling/rules.js';

// Load one bounded range in a single snapshot; calendar and slots use the same engine.
async function availabilityRange(context: PublicBusinessContext, serviceId: string, date: string, count: number, includeUnavailable: boolean, now: Date) {
  if (!Number.isInteger(count) || count < 1 || count > 31) throw new AppError(400, 'VALIDATION_ERROR', 'Choose up to 31 calendar days.');
  await validatePublicBusinessContext(context);
  return prisma.$transaction(async tx => {
    const business = await tx.business.findFirst({ where: { id: context.businessId, ...(context.ownedBookingId ? { approvalStatus: 'APPROVED', deletedAt: null } : publicBusinessWhere) }, include: { bookingPolicy: true } });
    if (!business) throw notFound();
    const ownedBooking = context.ownedBookingId ? await tx.booking.findFirst({ where: { id: context.ownedBookingId, customerId: context.customerId!, businessId: business.id, serviceId, status: 'CONFIRMED' }, select: { serviceDurationMinutes: true } }) : null;
    if (context.ownedBookingId && !ownedBooking) throw notFound();
    if (!business.bookingPolicy) throw conflict('This business has not finished setting its booking policy.');
    const policy = business.bookingPolicy;
    const service = await tx.service.findFirst({ where: { id: serviceId, businessId: business.id, ...(context.ownedBookingId ? {} : { active: true }) } });
    if (!service) throw notFound();
    const durationMinutes = ownedBooking?.serviceDurationMinutes ?? service.durationMinutes;
    const first = Temporal.PlainDate.from(date), end = first.add({ days: count });
    const fromDate = new Date(`${date}T00:00:00.000Z`), endDate = new Date(`${end}T00:00:00.000Z`);
    const rangeStart = new Date(Number(first.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const rangeEnd = new Date(Number(end.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const [overrides, weekly, links] = await Promise.all([
      tx.scheduleOverride.findMany({ where: { businessId: business.id, date: { gte: fromDate, lt: endDate } } }),
      tx.businessWeeklyAvailability.findMany({ where: { businessId: business.id } }),
      tx.staffService.findMany({ where: { businessId: business.id, serviceId: service.id, staff: { active: true } }, include: { staff: { include: {
        availability: { where: { businessId: business.id } }, overrides: { where: { businessId: business.id, date: { gte: fromDate, lt: endDate } } },
        bookings: { where: { businessId: business.id, ...(context.ownedBookingId ? { id: { not: context.ownedBookingId } } : {}), occupiedFrom: { lt: rangeEnd }, occupiedUntil: { gt: rangeStart }, OR: [{ status: 'CONFIRMED' }, { status: 'HELD', holdExpiresAt: { gt: now } }] }, select: { occupiedFrom: true, occupiedUntil: true, status: true, holdExpiresAt: true } },
        timeBlocks: { where: { businessId: business.id, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } }, select: { startsAt: true, endsAt: true } },
      } } } }),
    ]);
    const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
    const results = Array.from({ length: count }, (_, index) => {
      const day = first.add({ days: index }), key = day.toString(), weekday = day.dayOfWeek % 7;
      const businessWindows = effectiveWindows(overrides.find(item => item.date.toISOString().slice(0, 10) === key) ?? null, weekly.filter(item => item.weekday === weekday));
      return { date: key, ...generateAvailability({ date: key, timezone: business.timezone, now, durationMinutes, policy, businessWindows, includeUnavailable,
        staff: links.map(({ staff }) => ({ id: staff.id, displayName: staff.displayName, parallelCapacity: staff.parallelCapacity,
          windows: effectiveWindows(staff.overrides.find(item => item.date.toISOString().slice(0, 10) === key) ?? null, staff.availability.length ? staff.availability.filter(hours => hours.weekday === weekday) : businessWindows),
          bookings: staff.bookings.map(booking => ({ startsAt: booking.occupiedFrom, endsAt: booking.occupiedUntil, status: booking.status, holdExpiresAt: booking.holdExpiresAt })), blocks: staff.timeBlocks,
        })),
      }) };
    });
    return { timezone: business.timezone, today: today.toString(), maximumDate: today.add({ days: policy.maximumAdvanceDays }).toString(), service: { id: service.id, durationMinutes }, results };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
}
export async function getBusinessAvailability(context: PublicBusinessContext, serviceId: string, date: string, includeUnavailable = false, now = new Date()) {
  const range = await availabilityRange(context, serviceId, date, 1, includeUnavailable, now);
  const result = range.results[0];
  if (!result) throw notFound();
  const { date: _date, ...availability } = result;
  return { timezone: range.timezone, service: range.service, advisory: true as const, slotStepMinutes: 15, ...availability };
}
export async function getBusinessBookingCalendar(context: PublicBusinessContext, serviceId: string, fromDate: string, count = 31, now = new Date()) {
  const range = await availabilityRange(context, serviceId, fromDate, count, false, now);
  return { timezone: range.timezone, today: range.today, maximumDate: range.maximumDate, advisory: true, days: range.results.map(day => ({ date: day.date, available: day.slots.some(slot => slot.available) })) };
}

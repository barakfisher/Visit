import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../db/client.js';
import { conflict, notFound } from '../http/errors.js';
import { validatePublicBusinessContext, type PublicBusinessContext } from '../security/tenant-context.js';
import { generateAvailability } from '../scheduling/availability.js';
import { effectiveWindows } from '../scheduling/rules.js';

export async function getBusinessAvailability(context: PublicBusinessContext, serviceId: string, date: string, includeUnavailable = false, now = new Date()) {
  await validatePublicBusinessContext(context);
  return prisma.$transaction(async tx => {
    // Availability eligibility is centralized here. VIS-34 adds the publication lifecycle
    // predicate; approval by itself must not be treated as production publication.
    const business = await tx.business.findFirst({ where: { id: context.businessId, approvalStatus: 'APPROVED' }, include: { bookingPolicy: true } });
    if (!business) throw notFound();
    if (!business.bookingPolicy) throw conflict('This business has not finished setting its booking policy.');
    const service = await tx.service.findFirst({ where: { id: serviceId, businessId: business.id, active: true } });
    if (!service) throw notFound();
    const day = Temporal.PlainDate.from(date), weekday = day.dayOfWeek % 7;
    const dateValue = new Date(`${date}T00:00:00.000Z`);
    const dayStart = new Date(Number(day.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const dayEnd = new Date(Number(day.add({ days: 1 }).toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const [override, weekly, links] = await Promise.all([
      tx.scheduleOverride.findFirst({ where: { businessId: business.id, date: dateValue } }),
      tx.businessWeeklyAvailability.findMany({ where: { businessId: business.id, weekday } }),
      tx.staffService.findMany({ where: { businessId: business.id, serviceId: service.id, staff: { active: true } }, include: { staff: { include: {
        availability: { where: { businessId: business.id } }, overrides: { where: { businessId: business.id, date: dateValue } },
        bookings: { where: { businessId: business.id, occupiedFrom: { lt: dayEnd }, occupiedUntil: { gt: dayStart }, OR: [{ status: 'CONFIRMED' }, { status: 'HELD', holdExpiresAt: { gt: now } }] }, select: { occupiedFrom: true, occupiedUntil: true, status: true, holdExpiresAt: true } },
        timeBlocks: { where: { businessId: business.id, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, select: { startsAt: true, endsAt: true } },
      } } } }),
    ]);
    const businessWindows = effectiveWindows(override, weekly);
    const result = generateAvailability({ date, timezone: business.timezone, now, durationMinutes: service.durationMinutes, policy: business.bookingPolicy, businessWindows, includeUnavailable,
      staff: links.map(({ staff }) => ({ id: staff.id, displayName: staff.displayName, parallelCapacity: staff.parallelCapacity,
        windows: effectiveWindows(staff.overrides[0] ?? null, staff.availability.length ? staff.availability.filter(hours => hours.weekday === weekday) : businessWindows),
        bookings: staff.bookings.map(booking => ({ startsAt: booking.occupiedFrom, endsAt: booking.occupiedUntil, status: booking.status, holdExpiresAt: booking.holdExpiresAt })), blocks: staff.timeBlocks,
      })),
    });
    return { timezone: business.timezone, service: { id: service.id, durationMinutes: service.durationMinutes }, advisory: true as const, slotStepMinutes: 15, ...result };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 5000 });
}

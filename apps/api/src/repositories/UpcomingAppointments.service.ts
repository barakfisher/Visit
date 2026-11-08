import { prisma } from '../db/client.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { customerBookingActions } from './BookingActions.utils.js';
import { bookingServiceSnapshot } from './bookings.js';
const localDay = (instant: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
/** The appointments that fall on today's date, each by its own business's calendar. */
export function onLocalToday<T extends { startsAt: Date; business: { timezone: string } }>(appointments: T[], now: Date) {
  return appointments.filter(({ startsAt, business: { timezone } }) => localDay(startsAt, timezone) === localDay(now, timezone));
}
const WITHIN_ANY_LOCAL_TODAY_MS = 48 * 60 * 60 * 1000;
const MAX_TODAY_APPOINTMENTS = 20;
const appointmentSelect = {
  id: true, status: true, revision: true, startsAt: true, endsAt: true,
  serviceId: true, serviceName: true, serviceDurationMinutes: true, servicePriceMinor: true, serviceCurrency: true,
  business: { select: { id: true, name: true, timezone: true, location: true, approvalStatus: true, deletedAt: true, bookingPolicy: { select: { cancellationCutoffMinutes: true, rescheduleCutoffMinutes: true } } } },
  staff: { select: { displayName: true } },
} as const;
export async function readUpcomingAppointment(session: AuthenticatedSession, businessId?: string) {
  await validateAuthenticatedSession(session);
  const now = new Date();
  const where = { customerId: session.identity.id, status: 'CONFIRMED' as const, startsAt: { gte: now }, ...(businessId ? { businessId } : {}) };
  const orderBy = [{ startsAt: 'asc' as const }, { id: 'asc' as const }];
  return prisma.$transaction(async tx => {
    const [booking, count, soon] = await Promise.all([
      tx.booking.findFirst({ where, orderBy, select: appointmentSelect }), tx.booking.count({ where }),
      tx.booking.findMany({ where: { ...where, startsAt: { gte: now, lt: new Date(+now + WITHIN_ANY_LOCAL_TODAY_MS) } }, orderBy, take: MAX_TODAY_APPOINTMENTS, select: appointmentSelect }),
    ]);
    const project = (item: NonNullable<typeof booking>) => ({ id: item.id, status: item.status, revision: item.revision, startsAt: item.startsAt, endsAt: item.endsAt,
      business: { id: item.business.id, name: item.business.name, timezone: item.business.timezone, location: item.business.location }, staff: item.staff, service: bookingServiceSnapshot(item), actions: customerBookingActions(item, +now) });
    return { booking: booking ? project(booking) : null, additionalCount: Math.max(0, count - 1), today: onLocalToday(soon, now).map(project) };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 5000 });
}

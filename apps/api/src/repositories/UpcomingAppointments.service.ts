import { prisma } from '../db/client.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { customerBookingActions } from './BookingActions.utils.js';
import { bookingServiceSnapshot } from './bookings.js';
export async function readUpcomingAppointment(session: AuthenticatedSession, businessId?: string) {
  await validateAuthenticatedSession(session);
  const now = new Date();
  const where = { customerId: session.identity.id, status: 'CONFIRMED' as const, startsAt: { gte: now }, ...(businessId ? { businessId } : {}) };
  return prisma.$transaction(async tx => {
    const [booking, count] = await Promise.all([
      tx.booking.findFirst({ where, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: {
        id: true, status: true, revision: true, startsAt: true, endsAt: true,
        serviceId: true, serviceName: true, serviceDurationMinutes: true, servicePriceMinor: true, serviceCurrency: true,
        business: { select: { id: true, name: true, timezone: true, approvalStatus: true, deletedAt: true, bookingPolicy: { select: { cancellationCutoffMinutes: true, rescheduleCutoffMinutes: true } } } },
        staff: { select: { displayName: true } },
      } }), tx.booking.count({ where }),
    ]);
    return { booking: booking ? { id: booking.id, status: booking.status, revision: booking.revision, startsAt: booking.startsAt, endsAt: booking.endsAt,
      business: { id: booking.business.id, name: booking.business.name, timezone: booking.business.timezone }, staff: booking.staff, service: bookingServiceSnapshot(booking), actions: customerBookingActions(booking, +now),
    } : null, additionalCount: Math.max(0, count - 1) };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 5000 });
}

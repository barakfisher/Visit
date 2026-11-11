import type { Booking } from '../generated/prisma/client.js';
import { customerOwnedBookingWhere } from '../security/booking-ownership.js';
import { prisma } from '../db/client.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { canMarkNoShow, presentedStatus } from './AppointmentOutcome.utils.js';
import { customerBookingActions } from './BookingActions.utils.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';

export async function listCustomerBookings(session: AuthenticatedSession) {
  await validateAuthenticatedSession(session);
  const bookings = await prisma.booking.findMany({
    where: { ...customerOwnedBookingWhere(session.identity.id), status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} } },
    include: {
      business: { select: { id: true, name: true, timezone: true } },
      staff: { select: { displayName: true } },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const now = Date.now();
  return bookings.map(booking => ({ ...customerAppointment(booking), status: presentedStatus(booking, now) }));
}

// Future scheduled appointments carry the same customer actions as Home and the details screen,
// so the Appointments page never offers a cancel or reschedule the server will refuse.
export async function listActiveCustomerBookings(session: AuthenticatedSession) {
  await validateAuthenticatedSession(session);
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { ...customerOwnedBookingWhere(session.identity.id), status: 'CONFIRMED', startsAt: { gte: now } },
    include: {
      business: { select: { id: true, name: true, timezone: true, approvalStatus: true, deletedAt: true, bookingPolicy: { select: { cancellationCutoffMinutes: true, rescheduleCutoffMinutes: true } } } },
      staff: { select: { displayName: true } },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return bookings.map(booking => ({ ...customerAppointment(booking), actions: customerBookingActions(booking, +now) }));
}

export async function listProviderBookings(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  const bookings = await prisma.booking.findMany({ where: { businessId: context.businessId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} } }, include: { staff: { select: { displayName: true } } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] });
  const now = Date.now();
  return bookings.map(booking => ({ ...booking, status: presentedStatus(booking, now), canMarkNoShow: canMarkNoShow(booking, now), service: bookingServiceSnapshot(booking) }));
}

export function bookingServiceSnapshot(booking: Pick<Booking, 'serviceId' | 'serviceName' | 'serviceDurationMinutes' | 'servicePriceMinor' | 'serviceCurrency'>) {
  return { id: booking.serviceId, name: booking.serviceName, durationMinutes: booking.serviceDurationMinutes, priceMinor: booking.servicePriceMinor, currency: booking.serviceCurrency };
}

/**
 * What a customer's own lists carry of an appointment: never the whole row. Through a linked card the list also holds
 * bookings the business entered, whose actor, fingerprint, notes and typed contacts are the business's (customer-cards.md).
 */
export function customerAppointment(booking: Pick<Booking, 'id' | 'businessId' | 'status' | 'revision' | 'startsAt' | 'endsAt' | 'serviceId' | 'serviceName' | 'serviceDurationMinutes' | 'servicePriceMinor' | 'serviceCurrency'> & { business: { id: string; name: string; timezone: string }; staff: { displayName: string } }) {
  return { id: booking.id, businessId: booking.businessId, status: booking.status, revision: booking.revision, startsAt: booking.startsAt, endsAt: booking.endsAt,
    business: { id: booking.business.id, name: booking.business.name, timezone: booking.business.timezone }, staff: { displayName: booking.staff.displayName }, service: bookingServiceSnapshot(booking) };
}

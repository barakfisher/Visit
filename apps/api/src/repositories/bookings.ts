import type { Booking } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';

export async function listCustomerBookings(session: AuthenticatedSession, activeOnly = false) {
  await validateAuthenticatedSession(session);
  const bookings = await prisma.booking.findMany({
    where: { customerId: session.identity.id, ...(activeOnly ? { status: 'CONFIRMED' as const, startsAt: { gte: new Date() } } : { status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} } }) },
    include: {
      business: { select: { id: true, name: true, timezone: true } },
      staff: { select: { displayName: true } },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return bookings.map(booking => ({ ...booking, service: bookingServiceSnapshot(booking) }));
}

export async function listProviderBookings(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  const bookings = await prisma.booking.findMany({ where: { businessId: context.businessId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} } }, include: { staff: { select: { displayName: true } } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] });
  return bookings.map(booking => ({ ...booking, service: bookingServiceSnapshot(booking) }));
}

export function bookingServiceSnapshot(booking: Pick<Booking, 'serviceId' | 'serviceName' | 'serviceDurationMinutes' | 'servicePriceMinor' | 'serviceCurrency'>) {
  return { id: booking.serviceId, name: booking.serviceName, durationMinutes: booking.serviceDurationMinutes, priceMinor: booking.servicePriceMinor, currency: booking.serviceCurrency };
}

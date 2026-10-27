import { prisma } from '../db/client.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { conflict, notFound } from '../http/errors.js';
import { bookingServiceSnapshot } from './bookings.js';
import { bookingCalendarBody } from './BookingCalendar.utils.js';
async function ownedAppointment(session: AuthenticatedSession, id: string) {
  await validateAuthenticatedSession(session);
  const booking = await prisma.booking.findFirst({ where: { id, customerId: session.identity.id, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} } }, include: { business: { select: { id: true, name: true, timezone: true, approvalStatus: true, deletedAt: true, bookingPolicy: true } }, staff: { select: { displayName: true } } } });
  if (!booking) throw notFound();
  return booking;
}
export async function readBookingDetails(session: AuthenticatedSession, id: string) {
  const booking = await ownedAppointment(session, id), policy = booking.business.bookingPolicy, now = Date.now();
  const notification = await prisma.bookingNotification.findUnique({ where: { businessId_bookingId: { businessId: booking.businessId, bookingId: booking.id } }, select: { createdAt: true } });
  return { id: booking.id, status: booking.status, revision: booking.revision, startsAt: booking.startsAt, endsAt: booking.endsAt, service: bookingServiceSnapshot(booking), staff: booking.staff,
    business: { id: booking.business.id, name: booking.business.name, timezone: booking.business.timezone }, cancellationCutoffMinutes: policy?.cancellationCutoffMinutes ?? 0,
    actions: { canExport: booking.status === 'CONFIRMED', canCancel: booking.status === 'CONFIRMED' && +booking.startsAt >= now + (policy?.cancellationCutoffMinutes ?? 0) * 60000, canReschedule: booking.status === 'CONFIRMED' && Boolean(policy) && booking.business.approvalStatus === 'APPROVED' && !booking.business.deletedAt && +booking.startsAt >= now + (policy?.rescheduleCutoffMinutes ?? 0) * 60000 },
    notification: { status: notification ? 'RECORDED' : 'LEGACY', recordedAt: notification?.createdAt ?? null, sms: 'UNSUPPORTED', whatsapp: 'UNSUPPORTED' },
  };
}
export async function readBookingCalendar(session: AuthenticatedSession, id: string, revision: number) {
  const booking = await ownedAppointment(session, id);
  if (booking.status !== 'CONFIRMED' || booking.revision !== revision) throw conflict('This appointment changed. Reload its details before exporting.');
  return { filename: `visit-${encodeURIComponent(booking.id)}.ics`, revision: booking.revision, body: bookingCalendarBody({ id: booking.id, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), updatedAt: booking.updatedAt.toISOString(), revision: booking.revision, business: booking.business, service: bookingServiceSnapshot(booking), staff: booking.staff }) };
}

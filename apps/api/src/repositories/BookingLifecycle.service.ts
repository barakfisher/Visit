import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict, notFound, unauthenticated } from '../http/errors.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { requireBusinessMembership } from '../security/tenant-context.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { releaseHold } from '../scheduling/reservations.js';
import type { AppointmentOutcome, BookingAuditReason, BookingAuditSource } from './BookingLifecycle.types.js';

export async function setBookingAudit(tx: Prisma.TransactionClient, actor: string, source: BookingAuditSource, reason: BookingAuditReason) {
  await tx.$queryRaw`SELECT set_config('visit.booking_actor', ${actor}, true), set_config('visit.booking_source', ${source}, true), set_config('visit.booking_reason', ${reason}, true)`;
}

export async function changeBookingOutcome(session: AuthenticatedSession, bookingId: string, outcome: AppointmentOutcome, businessId?: string, expectedRevision?: number) {
  await validateAuthenticatedSession(session);
  if (businessId) await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
  else if (outcome !== 'CANCELLED') throw notFound();
  const booking = await withBookingTransaction(async tx => {
    // Fence concurrent logout/revocation and role changes before authorizing the write.
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.sessionId} FOR SHARE`;
    if (!await tx.session.findFirst({ where: { id: session.sessionId, identityId: session.identity.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) throw unauthenticated();
    if (businessId) {
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "businessId" = ${businessId} AND "identityId" = ${session.identity.id} FOR SHARE`;
      if (!await tx.membership.findFirst({ where: { businessId, identityId: session.identity.id, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] }, business: { approvalStatus: 'APPROVED', deletedAt: null } }, select: { id: true } })) throw notFound();
    }
    if (businessId) await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} AND "businessId" = ${businessId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} AND "customerId" = ${session.identity.id} FOR UPDATE`;
    const current = await tx.booking.findFirst({ where: { id: bookingId, ...(businessId ? { businessId } : { customerId: session.identity.id }) }, include: { business: { select: { bookingPolicy: true } } } });
    if (!current) throw notFound();
    if (current.status === outcome) return current;
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw conflict('This appointment changed. Refresh before updating it.');
    if (current.status !== 'CONFIRMED' && !(outcome === 'CANCELLED' && current.status === 'HELD')) throw conflict('This appointment can no longer change status.');
    const now = new Date();
    if (outcome !== 'CANCELLED' && current.endsAt > now) throw conflict('Wait until the appointment has ended before recording its outcome.');
    if (!businessId && current.status === 'CONFIRMED' && !current.business.bookingPolicy) throw conflict('This business has not configured its cancellation policy.');
    if (!businessId && current.status === 'CONFIRMED' && current.startsAt.getTime() < now.getTime() + (current.business.bookingPolicy?.cancellationCutoffMinutes ?? 0) * 60000) throw conflict('The cancellation cutoff has passed for this appointment.');
    await setBookingAudit(tx, session.identity.id, businessId ? 'PROVIDER' : 'CUSTOMER', outcome === 'COMPLETED' ? 'APPOINTMENT_FINISHED' : outcome === 'NO_SHOW' ? 'CUSTOMER_ABSENT' : businessId ? 'PROVIDER_REQUEST' : 'CUSTOMER_REQUEST');
    return tx.booking.update({ where: { id: current.id }, data: { status: outcome, holdExpiresAt: null } });
  });
  if (outcome === 'CANCELLED' && booking.customerId) await releaseHold(booking.id, booking.customerId).catch(() => {});
  return { id: booking.id, status: booking.status, revision: booking.revision };
}

export async function readBookingHistory(session: AuthenticatedSession, bookingId: string, businessId?: string) {
  await validateAuthenticatedSession(session);
  if (businessId) await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, ...(businessId ? { businessId } : { customerId: session.identity.id }), events: { some: {} } }, select: {
    id: true, businessId: true, status: true, revision: true,
    events: { orderBy: { revision: 'asc' }, select: { id: true, revision: true, kind: true, source: true, reason: true, oldStatus: true, newStatus: true, oldStartsAt: true, oldEndsAt: true, newStartsAt: true, newEndsAt: true, oldStaffId: true, newStaffId: true, createdAt: true } },
  } });
  if (!booking) throw notFound();
  return booking;
}

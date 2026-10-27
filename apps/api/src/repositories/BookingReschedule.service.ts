import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound, unauthenticated } from '../http/errors.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { assertCustomerContact } from '../security/customer-contact.utils.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { occupiedInterval, assertCapacity } from '../scheduling/intervals.js';
import { assertWorkingHours } from '../scheduling/WorkingHours.service.js';
import { reserveHold, requireHold, releaseHold } from '../scheduling/reservations.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { requireBusinessMembership } from '../security/tenant-context.js';
import { setBookingAudit } from './BookingLifecycle.service.js';

export const rescheduleInputSchema = z.strictObject({
  finalConsent: z.literal(true), idempotencyKey: z.string().min(16).max(128), expectedRevision: z.number().int().nonnegative(),
  staffId: z.string().min(1).max(256), startsAt: z.string().datetime({ offset: true }).optional(),
  localDate: z.string().date().optional(), localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), utcOffset: z.string().optional(),
}).refine(input => input.startsAt ? !input.localDate && !input.localTime && !input.utcOffset : Boolean(input.localDate && input.localTime), 'Provide one appointment time.');

export async function rescheduleBooking(session: AuthenticatedSession, bookingId: string, input: z.infer<typeof rescheduleInputSchema>, businessId?: string) {
  await validateAuthenticatedSession(session);
  if (businessId) await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
  const scope = businessId ? { businessId } : { customerId: session.identity.id };
  const original = await prisma.booking.findFirst({ where: { id: bookingId, ...scope }, include: { business: { select: { timezone: true } } } });
  if (!original) throw notFound();
  let startsAt: Date;
  try {
    if (input.startsAt) startsAt = new Date(input.startsAt);
    else if (input.localDate && input.localTime) startsAt = localDateTimeToInstant(input.localDate, input.localTime, original.business.timezone, input.utcOffset);
    else throw new Error('Choose a time.');
  } catch { throw new AppError(400, 'INVALID_LOCAL_TIME', 'Review the appointment time.'); }
  if (!Number.isFinite(+startsAt) || startsAt.getUTCSeconds() || startsAt.getUTCMilliseconds()) throw new AppError(400, 'INVALID_LOCAL_TIME', 'Appointment starts must be on a whole minute.');
  const fingerprint = JSON.stringify([input.staffId, startsAt.toISOString(), input.expectedRevision]);
  const key = { bookingId_idempotencyKey: { bookingId, idempotencyKey: input.idempotencyKey } };
  const response = (booking: { id: string; status: string; revision: number; startsAt: Date; endsAt: Date }) => ({ id: booking.id, status: booking.status, revision: booking.revision, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString() });
  const prior = await prisma.bookingReschedule.findUnique({ where: key });
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw conflict('This attempt was used for different details.');
    return response(original);
  }
  // Each worker owns a distinct bounded Redis lease; retries cannot release each other's lease.
  const reservationId = `reschedule:${randomUUID()}`;
  try {
    return await withBookingTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.sessionId} FOR SHARE`;
      if (!await tx.session.findFirst({ where: { id: session.sessionId, identityId: session.identity.id, revokedAt: null, expiresAt: { gt: new Date() } } })) throw unauthenticated();
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${original.businessId} FOR SHARE`;
      if (businessId) {
        await tx.$queryRaw`SELECT id FROM "Membership" WHERE "businessId" = ${businessId} AND "identityId" = ${session.identity.id} FOR SHARE`;
        if (!await tx.membership.findFirst({ where: { businessId, identityId: session.identity.id, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } } })) throw notFound();
        await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} AND "businessId" = ${businessId} FOR UPDATE`;
      } else await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} AND "customerId" = ${session.identity.id} FOR UPDATE`;
      const current = await tx.booking.findFirst({ where: { id: bookingId, ...scope }, include: { business: { include: { bookingPolicy: true } } } });
      if (!current) throw notFound();
      const committed = await tx.bookingReschedule.findUnique({ where: key });
      if (committed) {
        if (committed.fingerprint !== fingerprint) throw conflict('This attempt was used for different details.');
        return response(current);
      }
      if (current.status !== 'CONFIRMED' || current.revision !== input.expectedRevision) throw conflict('This appointment changed. Refresh before rescheduling.');
      const business = current.business, policy = business.bookingPolicy;
      if (business.approvalStatus !== 'APPROVED' || business.deletedAt) throw notFound();
      if (!policy) throw conflict('This business has not configured its booking policy.');
      const now = new Date();
      if (+current.startsAt < +now + policy.rescheduleCutoffMinutes * 60000) throw conflict('The reschedule cutoff has passed.');
      const localDate = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
      const horizon = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
      if (+startsAt < +now + policy.minimumNoticeMinutes * 60000 || Temporal.PlainDate.compare(localDate, horizon) > 0) throw conflict('The requested time is outside the booking window.');
      assertCustomerContact(policy, await tx.identity.findUniqueOrThrow({ where: { id: current.customerId } }));
      const link = await tx.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId: business.id, staffId: input.staffId, serviceId: current.serviceId } }, include: { staff: true } });
      // Archived services remain manageable using the immutable original service snapshot.
      if (!link?.staff.active) throw notFound();
      const occupied = occupiedInterval(startsAt, current.serviceDurationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
      await assertWorkingHours(business.id, business.timezone, input.staffId, startsAt, occupied, tx);
      if (await tx.timeBlock.count({ where: { businessId: business.id, staffId: input.staffId, startsAt: { lt: occupied.endsAt }, endsAt: { gt: occupied.startsAt } } })) throw conflict('This provider has blocked this time.');
      const conflicts = await tx.booking.findMany({ where: { businessId: business.id, staffId: input.staffId, id: { not: bookingId }, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, { status: 'HELD', holdExpiresAt: { gt: now } }], occupiedFrom: { lt: occupied.endsAt }, occupiedUntil: { gt: occupied.startsAt } }, select: { occupiedFrom: true, occupiedUntil: true } });
      if (!assertCapacity(occupied, conflicts.map(item => ({ startsAt: item.occupiedFrom, endsAt: item.occupiedUntil })), link.staff.parallelCapacity)) throw conflict('That time was just booked. Choose another time.');
      await reserveHold({ id: reservationId, customerId: session.identity.id, businessId: business.id, staffId: input.staffId, occupiedFrom: occupied.startsAt, occupiedUntil: occupied.endsAt, holdExpiresAt: new Date(Date.now() + 30000) }, link.staff.parallelCapacity);
      await requireHold(reservationId, session.identity.id);
      await setBookingAudit(tx, session.identity.id, businessId ? 'PROVIDER' : 'CUSTOMER', businessId ? 'PROVIDER_REQUEST' : 'CUSTOMER_REQUEST');
      const updated = await tx.booking.update({ where: { id: bookingId }, data: { staffId: input.staffId, startsAt, endsAt: new Date(+startsAt + current.serviceDurationMinutes * 60000), occupiedFrom: occupied.startsAt, occupiedUntil: occupied.endsAt } });
      await tx.bookingReschedule.create({ data: { bookingId, idempotencyKey: input.idempotencyKey, fingerprint } });
      return response(updated);
    });
  } finally { await releaseHold(reservationId, session.identity.id).catch(() => {}); }
}

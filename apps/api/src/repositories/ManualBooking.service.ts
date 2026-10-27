import { createHash, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import type { Booking } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { requireBusinessMembership } from '../security/tenant-context.js';
import { publicBusinessWhere } from '../security/business-eligibility.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { acquireIntervalLocks } from '../scheduling/redis-slot-lock.js';
import { occupiedInterval, assertCapacity } from '../scheduling/intervals.js';
import { assertWorkingHours } from '../scheduling/WorkingHours.service.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { reserveHold, requireHold, releaseHold } from '../scheduling/reservations.js';
import { fenceScheduleSession } from './ScheduleImpact.service.js';
import { setBookingAudit } from './BookingLifecycle.service.js';
import { reviewedServiceSchema } from '../scheduling/booking-consent.utils.js';

export const manualBookingSchema = z.strictObject({
  finalConsent: z.literal(true), idempotencyKey: z.string().uuid(), serviceId: z.string().min(1).max(256), staffId: z.string().min(1).max(256),
  localDate: z.string().date(), localTime: z.string().regex(/^\d{2}:\d{2}$/), utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/).optional(),
  customerName: z.string().trim().min(2).max(120).refine(value => [...value].length >= 2), customerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/), customerEmail: z.string().trim().email().max(254).optional(),
  exceptionReason: z.string().trim().min(5).max(500).refine(value => [...value].length >= 5).optional(), reviewedService: reviewedServiceSchema,
});
type ManualInput = z.infer<typeof manualBookingSchema>;
function result(booking: Booking) { return { id: booking.id, status: booking.status, startsAt: booking.startsAt, endsAt: booking.endsAt, revision: booking.revision, source: 'MANUAL', contactVerification: 'UNVERIFIED', notification: 'NOT_SENT' }; }
export async function createManualBooking(session: AuthenticatedSession, businessId: string, input: ManualInput) {
  await validateAuthenticatedSession(session);
  await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  // A private actor-owned namespace prevents collisions with consumer booking attempts.
  const key = `manual:${session.identity.id}:${input.idempotencyKey}`;
  function recover(booking: Booking) {
    if (booking.source !== 'MANUAL' || booking.enteredByIdentityId !== session.identity.id) throw notFound();
    if (booking.manualFingerprint !== fingerprint) throw conflict('This attempt was used for different details.');
    return result(booking);
  }
  await prisma.manualBookingAttempt.createMany({ data: [{ businessId, actorId: session.identity.id, idempotencyKey: key, fingerprint }], skipDuplicates: true });
  const registered = await prisma.manualBookingAttempt.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } } });
  if (registered.actorId !== session.identity.id || registered.fingerprint !== fingerprint) throw conflict('This attempt was used for different details.');
  let slotLock: Awaited<ReturnType<typeof acquireIntervalLocks>> | undefined;
  const reservationId = `manual:${randomUUID()}`;
  try {
    return await withBookingTransaction(async tx => {
      await fenceScheduleSession(tx, session);
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "businessId" = ${businessId} AND "identityId" = ${session.identity.id} FOR SHARE`;
      if (!await tx.membership.findFirst({ where: { businessId, identityId: session.identity.id, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] }, business: { approvalStatus: 'APPROVED', deletedAt: null } } })) throw notFound();
      // Update the attempt row in the same commit as the booking. A waiting stale
      // Serializable worker must retry before it can interpret an availability error.
      await tx.$queryRaw`SELECT id FROM "ManualBookingAttempt" WHERE id = ${registered.id} FOR UPDATE`;
      const intent = await tx.manualBookingAttempt.findUniqueOrThrow({ where: { id: registered.id } });
      const prior = await tx.booking.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } } });
      if (prior) return recover(prior);
      if (intent.status !== 'PENDING') throw new AppError(409, 'MANUAL_ATTEMPT_REJECTED', 'This attempt was rejected. Review a new appointment.');
      const business = await tx.business.findFirst({ where: { id: businessId, ...publicBusinessWhere }, include: { bookingPolicy: true } });
      if (!business) throw conflict('Publish this business before creating appointments.');
      const policy = business.bookingPolicy;
      if (!policy) throw conflict('Configure the booking policy first.');
      const exception = policy.requireVerifiedPhone || policy.requireVerifiedEmail;
      if (exception && !input.exceptionReason) throw new AppError(400, 'MANUAL_EXCEPTION_REQUIRED', 'Record why this appointment uses unverified contact details.');
      const link = await tx.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId, staffId: input.staffId, serviceId: input.serviceId } }, include: { staff: true, service: true } });
      if (!link?.staff.active || !link.service.active) throw notFound();
      const service = link.service, reviewed = input.reviewedService;
      if (service.name !== reviewed.name || service.durationMinutes !== reviewed.durationMinutes || service.priceMinor !== reviewed.priceMinor || service.currency !== reviewed.currency) throw new AppError(409, 'SERVICE_CHANGED', 'The service changed. Review it again.');
      let startsAt: Date;
      try { startsAt = localDateTimeToInstant(input.localDate, input.localTime, business.timezone, input.utcOffset); } catch { throw new AppError(400, 'INVALID_LOCAL_TIME', 'Choose a valid unambiguous business-local time, or its UTC offset.'); }
      const now = new Date(), localDay = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
      const horizon = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
      if (+startsAt < +now + policy.minimumNoticeMinutes * 60000 || Temporal.PlainDate.compare(localDay, horizon) > 0) throw conflict('The requested time is outside the booking window.');
      const occupied = occupiedInterval(startsAt, service.durationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
      await assertWorkingHours(businessId, business.timezone, input.staffId, startsAt, occupied, tx);
      if (await tx.timeBlock.count({ where: { businessId, staffId: input.staffId, startsAt: { lt: occupied.endsAt }, endsAt: { gt: occupied.startsAt } } })) throw conflict('This provider has blocked this time.');
      // Share the consumer creation mutex before acquiring a reservation. This
      // avoids both contenders rejecting each other's provisional capacity.
      if (slotLock) { await releaseHold(reservationId, session.identity.id); await slotLock.release(); }
      slotLock = await acquireIntervalLocks(businessId, input.staffId, occupied);
      if (!slotLock.acquired) throw conflict('That time is being booked. Retry another reviewed attempt shortly.');
      const conflicts = await tx.booking.findMany({ where: { businessId, staffId: input.staffId, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, { status: 'HELD', holdExpiresAt: { gt: now } }], occupiedFrom: { lt: occupied.endsAt }, occupiedUntil: { gt: occupied.startsAt } }, select: { occupiedFrom: true, occupiedUntil: true } });
      if (!assertCapacity(occupied, conflicts.map(row => ({ startsAt: row.occupiedFrom, endsAt: row.occupiedUntil })), link.staff.parallelCapacity)) throw conflict('That time has no remaining capacity.');
      await reserveHold({ id: reservationId, businessId, staffId: input.staffId, customerId: session.identity.id, occupiedFrom: occupied.startsAt, occupiedUntil: occupied.endsAt, holdExpiresAt: new Date(Date.now() + 30000) }, link.staff.parallelCapacity);
      await requireHold(reservationId, session.identity.id);
      await setBookingAudit(tx, session.identity.id, 'MANUAL', exception ? 'MANUAL_CONTACT_EXCEPTION' : 'MANUAL_ENTRY');
      await tx.$queryRaw`SELECT set_config('visit.booking_session', ${session.sessionId}, true)`;
      const saved = await tx.booking.create({ data: { businessId, customerId: null, source: 'MANUAL', enteredByIdentityId: session.identity.id, manualFingerprint: fingerprint, manualReason: input.exceptionReason ?? null,
        customerName: input.customerName, customerPhone: input.customerPhone, customerEmail: input.customerEmail ?? null, staffId: input.staffId, serviceId: input.serviceId, startsAt, endsAt: new Date(+startsAt + service.durationMinutes * 60000), occupiedFrom: occupied.startsAt, occupiedUntil: occupied.endsAt, idempotencyKey: key, status: 'CONFIRMED' } });
      await tx.manualBookingAttempt.update({ where: { id: registered.id }, data: { status: 'CONFIRMED' } });
      return result(saved);
    });
  } catch (error) {
    const unique = error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
    const definite = error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500 && ![408, 429].includes(error.statusCode);
    if (unique || definite) {
      // A rejection is authoritative only after the same lock fences every worker.
      // If a lost-response worker committed first, recover its result instead.
      const committed = await withBookingTransaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "ManualBookingAttempt" WHERE id = ${registered.id} FOR UPDATE`;
        const prior = await tx.booking.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } } });
        if (prior) return prior;
        await tx.manualBookingAttempt.update({ where: { id: registered.id }, data: { status: 'REJECTED' } });
        return null;
      }).catch(() => { throw new AppError(503, 'MANUAL_ATTEMPT_PENDING', 'Retry this same appointment to recover its result.'); });
      if (committed) {
        await validateAuthenticatedSession(session);
        await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
        return recover(committed);
      }
    }
    throw error;
  } finally { await releaseHold(reservationId, session.identity.id).catch(() => {}); if (slotLock) await slotLock.release(); }
}

export async function readManualBookingOptions(session: AuthenticatedSession, businessId: string) {
  await validateAuthenticatedSession(session);
  await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
  return prisma.$transaction(async tx => {
    const business = await tx.business.findFirst({ where: { id: businessId, approvalStatus: 'APPROVED', deletedAt: null }, select: { timezone: true, publishedAt: true, bookingPolicy: { select: { requireVerifiedPhone: true, requireVerifiedEmail: true } }, services: { where: { active: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, durationMinutes: true, priceMinor: true, currency: true, staff: { where: { staff: { active: true } }, select: { staff: { select: { id: true, displayName: true, parallelCapacity: true } } } } } } } });
    if (!business) throw notFound();
    return { timezone: business.timezone, bookable: Boolean(business.publishedAt && business.bookingPolicy), requiresException: Boolean(business.bookingPolicy?.requireVerifiedPhone || business.bookingPolicy?.requireVerifiedEmail), services: business.services.map(service => ({ ...service, staff: service.staff.map(link => link.staff) })) };
  }, { isolationLevel: 'RepeatableRead' });
}

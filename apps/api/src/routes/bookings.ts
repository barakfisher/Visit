import { readBookingDetails, readBookingCalendar } from '../repositories/BookingDetails.service.js';
import { changeBookingOutcome, readBookingHistory, setBookingAudit } from '../repositories/BookingLifecycle.service.js';
import { reviewedServiceSchema } from '../scheduling/booking-consent.utils.js';
import type { Booking } from '../generated/prisma/client.js';
import { ensureRedisReady } from '../infra/redis.js';
import { reserveHold, requireHold, releaseHold } from '../scheduling/reservations.js';
import { assertCustomerContact } from '../security/customer-contact.utils.js';
import { publicBusinessWhere } from '../security/business-eligibility.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { BookingStatus, MembershipRole } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { occupiedInterval, assertCapacity } from '../scheduling/intervals.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { acquireIntervalLocks } from '../scheduling/redis-slot-lock.js';
import { authenticate } from '../security/sessions.js';
import { requireBusinessMembership, requirePublicBusiness } from '../security/tenant-context.js';
import { assertWorkingHours } from '../scheduling/WorkingHours.service.js';
import { rescheduleBooking, rescheduleInputSchema } from '../repositories/BookingReschedule.service.js';
import { getBusinessAvailability } from '../repositories/availability.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { listCustomerBookings, listProviderBookings } from '../repositories/bookings.js';

const activeStatuses = [BookingStatus.HELD, BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW];
const asError = (error: unknown) => error instanceof Error ? error.message : 'Invalid time.';


function bookingResponse(booking: Booking) { return { id: booking.id, status: booking.status, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), holdExpiresAt: booking.holdExpiresAt?.toISOString() }; }
async function ensureReservation(booking: Booking) {
  if (booking.status === 'CONFIRMED') return;
  if (booking.status !== 'HELD') throw new AppError(409, 'HOLD_EXPIRED', 'This attempt is no longer active. Choose a time again.');
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: booking.staffId } });
  try { await reserveHold(booking, staff.parallelCapacity); }
  catch (error) {
    if (error instanceof AppError && error.statusCode === 409) {
      await prisma.booking.updateMany({ where: { id: booking.id, customerId: booking.customerId, status: 'HELD' }, data: { status: 'EXPIRED', holdExpiresAt: null } });
      await releaseHold(booking.id, booking.customerId).catch(() => {});
    }
    throw error;
  }
}

export async function registerBookingRoutes(app: FastifyInstance, { acquireLocks = acquireIntervalLocks }: { acquireLocks?: typeof acquireIntervalLocks } = {}) {
  app.get('/v1/businesses/:businessId/availability', async (request) => {
    const params = z.object({ businessId: z.string().min(1) }).safeParse(request.params);
    const query = z.object({ serviceId: z.string().min(1), date: z.string().date(), includeUnavailable: z.enum(['true']).optional() }).safeParse(request.query);
    if (!params.success || !query.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a business, service, and local date.');
    return getBusinessAvailability(await requirePublicBusiness(params.data.businessId), query.data.serviceId, query.data.date, query.data.includeUnavailable === 'true');
  });

  app.post('/v1/bookings', async (request, reply) => {
    const { identity } = await authenticate(request);
    const parsed = z.object({ finalConsent: z.literal(true), reviewedService: reviewedServiceSchema.optional(), businessId: z.string().min(1), serviceId: z.string().min(1), staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }).optional(), localDate: z.string().date().optional(), localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), utcOffset: z.string().optional(), idempotencyKey: z.string().min(16).max(128) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a service, provider, and valid appointment time.');
    const input = parsed.data;
    if ((!input.startsAt && (!input.localDate || !input.localTime)) || (input.startsAt && (input.localDate || input.localTime || input.utcOffset))) throw new AppError(400, 'VALIDATION_ERROR', 'Provide either an instant or a local date and time.');

    // Recover committed results before checking mutable publication/service state.
    const recovered = await prisma.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } } });
    if (recovered && recovered.customerId !== identity.id) throw notFound();
    if (recovered) {
      let requestedStart: Date;
      try {
        const zone = input.startsAt ? null : await prisma.business.findUniqueOrThrow({ where: { id: input.businessId }, select: { timezone: true } });
        requestedStart = input.startsAt ? new Date(input.startsAt) : localDateTimeToInstant(input.localDate!, input.localTime!, zone?.timezone ?? 'Asia/Jerusalem', input.utcOffset);
      } catch { throw new AppError(400, 'INVALID_LOCAL_TIME', 'Review the appointment time.'); }
      if (recovered.serviceId !== input.serviceId || recovered.staffId !== input.staffId || recovered.startsAt.getTime() !== requestedStart.getTime()) throw conflict('This attempt was already used for different details.');
      if (input.reviewedService && (input.reviewedService.name !== recovered.serviceName || input.reviewedService.durationMinutes !== recovered.serviceDurationMinutes || input.reviewedService.priceMinor !== recovered.servicePriceMinor || input.reviewedService.currency !== recovered.serviceCurrency)) throw conflict('This attempt was already used for different service details.');
      if (['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(recovered.status)) return bookingResponse(recovered);
    }
    if (await prisma.bookingAttempt.findFirst({ where: { businessId: input.businessId, idempotencyKey: input.idempotencyKey, status: 'REJECTED' }, select: { id: true } })) throw new AppError(409, 'ATTEMPT_REJECTED', 'This attempt is no longer active.');
    try { await ensureRedisReady(); } catch { throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable.'); }
    const business = await prisma.business.findFirst({ where: { id: input.businessId, ...publicBusinessWhere }, select: { id: true, timezone: true, bookingPolicy: true } });
    if (!business) throw notFound();
    if (!business.bookingPolicy) throw conflict('This business has not finished setting its booking policy.');
    let startsAt: Date;
    try { startsAt = input.startsAt ? new Date(input.startsAt) : localDateTimeToInstant(input.localDate!, input.localTime!, business.timezone, input.utcOffset); }
    catch (error) { throw new AppError(400, 'INVALID_LOCAL_TIME', asError(error)); }
    if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0) throw new AppError(400, 'INVALID_LOCAL_TIME', 'Appointment starts must be on a whole minute.');
    const now = new Date();
    const policy = business.bookingPolicy;
    assertCustomerContact(policy, await prisma.identity.findUniqueOrThrow({ where: { id: identity.id } }));
    const startDateInZone = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
    const maximumLocalDate = Temporal.Now.zonedDateTimeISO(business.timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
    if (startsAt.getTime() < now.getTime() + policy.minimumNoticeMinutes * 60_000 || Temporal.PlainDate.compare(startDateInZone, maximumLocalDate) > 0) throw conflict('The requested time is outside this business’s booking window.');

    const [service, staffLink] = await Promise.all([
      prisma.service.findFirst({ where: { id: input.serviceId, businessId: business.id, active: true } }),
      prisma.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId: business.id, staffId: input.staffId, serviceId: input.serviceId } }, include: { staff: true } }),
    ]);
    if (!service || !staffLink?.staff.active) throw notFound();
    if (input.reviewedService && (input.reviewedService.name !== service.name || input.reviewedService.durationMinutes !== service.durationMinutes || input.reviewedService.priceMinor !== service.priceMinor || input.reviewedService.currency !== service.currency)) throw conflict('This service changed since review. Review the appointment again.');
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    const occupied = occupiedInterval(startsAt, service.durationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
    await assertWorkingHours(business.id, business.timezone, input.staffId, startsAt, occupied);
    if (startsAt.getTime() < now.getTime() + policy.minimumNoticeMinutes * 60_000) throw conflict('The requested time is outside this business’s booking window.');
    const holdExpiresAt = new Date(now.getTime() + 5 * 60_000);
    const matchesRequest = (candidate: { customerId: string; serviceId: string; staffId: string; startsAt: Date }) => candidate.customerId === identity.id && candidate.serviceId === service.id && candidate.staffId === staffLink.staff.id && candidate.startsAt.getTime() === startsAt.getTime();
    const prior = await prisma.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
    if (prior) {
      if (!matchesRequest(prior)) throw conflict('That idempotency key was already used for a different booking request.');
      await ensureReservation(prior);
      reply.code(200);
      return { id: prior.id, status: prior.status, startsAt: prior.startsAt.toISOString(), endsAt: prior.endsAt.toISOString(), holdExpiresAt: prior.holdExpiresAt?.toISOString() };
    }
    const slotLock = await acquireLocks(business.id, staffLink.staff.id, occupied);
    if (!slotLock.acquired) throw conflict('That time is being booked. Choose another time or retry shortly.');
    try {
      const booking = await withBookingTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${business.id} FOR SHARE`;
        if (!await tx.business.findFirst({ where: { id: business.id, ...publicBusinessWhere }, select: { id: true } })) throw conflict('This business is not published for bookings.');
        const currentPolicy = await tx.bookingPolicy.findUnique({ where: { businessId: business.id } });
        if (!currentPolicy || currentPolicy.minimumNoticeMinutes !== policy.minimumNoticeMinutes || currentPolicy.maximumAdvanceDays !== policy.maximumAdvanceDays || currentPolicy.bufferBeforeMinutes !== policy.bufferBeforeMinutes || currentPolicy.bufferAfterMinutes !== policy.bufferAfterMinutes) throw conflict('Booking policy changed. Review the appointment again.');
        await assertWorkingHours(business.id, business.timezone, input.staffId, startsAt, occupied, tx);
        const existing = await tx.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
        if (existing) {
          if (!matchesRequest(existing)) throw conflict('That idempotency key was already used for a different booking request.');
          return existing;
        }
        const currentStaffLink = await tx.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId: business.id, staffId: input.staffId, serviceId: input.serviceId } }, include: { staff: true } });
        if (!currentStaffLink?.staff.active) throw conflict('This staff assignment changed. Choose an available provider.');
        await tx.booking.updateMany({ where: { businessId: business.id, staffId: input.staffId, status: BookingStatus.HELD, holdExpiresAt: { lte: now } }, data: { status: BookingStatus.EXPIRED } });
        const conflicts = await tx.booking.findMany({ where: { businessId: business.id, staffId: input.staffId, status: { in: activeStatuses }, occupiedFrom: { lt: occupied.endsAt }, occupiedUntil: { gt: occupied.startsAt } }, select: { occupiedFrom: true, occupiedUntil: true } });
        if (!assertCapacity(occupied, conflicts.map((item) => ({ startsAt: item.occupiedFrom, endsAt: item.occupiedUntil })), currentStaffLink.staff.parallelCapacity)) throw conflict('That time was just booked. Choose another time.');
        if (await tx.timeBlock.count({ where: { businessId: business.id, staffId: input.staffId, startsAt: { lt: occupied.endsAt }, endsAt: { gt: occupied.startsAt } } })) throw conflict('This provider has blocked this time. Choose another time.');
        await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${service.id} AND "businessId" = ${business.id} FOR SHARE`;
        const currentService = await tx.service.findFirst({ where: { id: service.id, businessId: business.id, active: true } });
        if (!currentService || currentService.updatedAt.getTime() !== service.updatedAt.getTime() || currentService.name !== service.name || currentService.durationMinutes !== service.durationMinutes || currentService.priceMinor !== service.priceMinor || currentService.currency !== service.currency) throw conflict('This service changed. Review the service and select a time again.');
        return tx.booking.create({ data: { businessId: business.id, customerId: identity.id, staffId: input.staffId, serviceId: service.id, startsAt, endsAt, occupiedFrom: occupied.startsAt, occupiedUntil: occupied.endsAt, idempotencyKey: input.idempotencyKey, status: BookingStatus.HELD, holdExpiresAt } });
      });
      await ensureReservation(booking);
      reply.code(201);
      return { id: booking.id, status: booking.status, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), holdExpiresAt: booking.holdExpiresAt?.toISOString() };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') throw conflict('Availability changed. Choose another time and retry.');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const existing = await prisma.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
        if (existing && matchesRequest(existing)) {
          await ensureReservation(existing);
          reply.code(200);
          return { id: existing.id, status: existing.status, startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString(), holdExpiresAt: existing.holdExpiresAt?.toISOString() };
        }
        throw conflict('That idempotency key was already used for a different booking request.');
      }
      throw error;
    } finally { await slotLock.release(); }
  });

  app.post('/v1/bookings/:bookingId/confirm', async (request) => {
    const { identity } = await authenticate(request);
    const params = z.object({ bookingId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw notFound();
    const booking = await prisma.booking.findFirst({ where: { id: params.data.bookingId, customerId: identity.id } });
    if (!booking) throw notFound();
    if (booking.status === BookingStatus.CONFIRMED) return { id: booking.id, status: booking.status };
    if (booking.status !== BookingStatus.HELD || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) throw conflict('This appointment hold has expired. Start again to choose a new time.');
    await withBookingTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${booking.businessId} FOR SHARE`;
      if (!await tx.business.findFirst({ where: { id: booking.businessId, ...publicBusinessWhere }, select: { id: true } })) throw conflict('This business is not published. The temporary hold cannot be confirmed.');
      await tx.$queryRaw`SELECT id FROM "BookingAttempt" WHERE "businessId" = ${booking.businessId} AND "idempotencyKey" = ${booking.idempotencyKey} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${booking.id} FOR UPDATE`;
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (current.status === 'CONFIRMED') return;
      if (current.status !== 'HELD') throw conflict('This booking attempt is no longer active.');
      const business = await tx.business.findUniqueOrThrow({ where: { id: booking.businessId }, include: { bookingPolicy: true } });
      const policy = business.bookingPolicy;
      if (!policy) throw conflict('This business has not configured its booking policy.');
      const link = await tx.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId: booking.businessId, staffId: current.staffId, serviceId: current.serviceId } }, include: { staff: true, service: true } });
      if (!link?.staff.active || !link.service.active || link.service.name !== current.serviceName || link.service.durationMinutes !== current.serviceDurationMinutes || link.service.priceMinor !== current.servicePriceMinor || link.service.currency !== current.serviceCurrency) throw conflict('The service or staff changed. Review a new time.');
      const occupied = occupiedInterval(current.startsAt, current.serviceDurationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
      if (occupied.startsAt.getTime() !== current.occupiedFrom.getTime() || occupied.endsAt.getTime() !== current.occupiedUntil.getTime()) throw conflict('Booking buffers changed. Review a new time.');
      const localDate = Temporal.Instant.from(current.startsAt.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
      const horizon = Temporal.Now.zonedDateTimeISO(business.timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
      if (current.startsAt.getTime() < Date.now() + policy.minimumNoticeMinutes * 60000 || Temporal.PlainDate.compare(localDate, horizon) > 0) throw conflict('The requested time is outside this business’s booking window.');
      await assertWorkingHours(business.id, business.timezone, current.staffId, current.startsAt, occupied, tx);
      if (await tx.timeBlock.count({ where: { businessId: business.id, staffId: current.staffId, startsAt: { lt: occupied.endsAt }, endsAt: { gt: occupied.startsAt } } })) throw conflict('This time is blocked. Choose another time.');
      // Recheck complete Redis ownership after database locks, immediately before the write.
      await requireHold(current.id, identity.id);
      await setBookingAudit(tx, identity.id, 'CUSTOMER', 'FINAL_CONSENT');
      const result = await tx.booking.updateMany({ where: { id: booking.id, customerId: identity.id, status: BookingStatus.HELD, holdExpiresAt: { gt: new Date() } }, data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null } });
      if (result.count !== 1) throw conflict('This appointment hold has expired. Start again to choose a new time.');
    });
    await releaseHold(booking.id, identity.id).catch(() => {});
    return { id: booking.id, status: BookingStatus.CONFIRMED };
  });

  app.post('/v1/bookings/:bookingId/reschedule', async request => {
    const session = await authenticate(request);
    const { bookingId } = z.object({ bookingId: z.string().min(1).max(256) }).parse(request.params);
    return rescheduleBooking(session, bookingId, rescheduleInputSchema.parse(request.body));
  });

  app.post('/v1/provider/businesses/:businessId/bookings/:bookingId/reschedule', async request => {
    const session = await authenticate(request);
    const { bookingId, businessId } = z.object({ bookingId: z.string().min(1).max(256), businessId: z.string().min(1).max(256) }).parse(request.params);
    return rescheduleBooking(session, bookingId, rescheduleInputSchema.parse(request.body), businessId);
  });

  app.post('/v1/bookings/:bookingId/cancel', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1) }).parse(request.params);
    const { expectedRevision } = z.strictObject({ expectedRevision: z.number().int().nonnegative().optional() }).parse(request.body ?? {});
    return changeBookingOutcome(await authenticate(request), bookingId, 'CANCELLED', undefined, expectedRevision);
  });
  app.post('/v1/provider/businesses/:businessId/bookings/:bookingId/cancel', async request => {
    const { businessId, bookingId } = z.object({ businessId: z.string().min(1), bookingId: z.string().min(1) }).parse(request.params);
    const { expectedRevision } = z.strictObject({ expectedRevision: z.number().int().nonnegative().optional() }).parse(request.body ?? {});
    return changeBookingOutcome(await authenticate(request), bookingId, 'CANCELLED', businessId, expectedRevision);
  });
  app.post('/v1/provider/businesses/:businessId/bookings/:bookingId/outcome', async request => {
    const { businessId, bookingId } = z.object({ businessId: z.string().min(1), bookingId: z.string().min(1) }).parse(request.params);
    const { status, expectedRevision } = z.strictObject({ status: z.enum(['COMPLETED', 'NO_SHOW']), expectedRevision: z.number().int().nonnegative() }).parse(request.body);
    return changeBookingOutcome(await authenticate(request), bookingId, status, businessId, expectedRevision);
  });
  app.get('/v1/bookings/:bookingId/history', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1) }).parse(request.params);
    return readBookingHistory(await authenticate(request), bookingId);
  });
  app.get('/v1/provider/businesses/:businessId/bookings/:bookingId/history', async request => {
    const { businessId, bookingId } = z.object({ businessId: z.string().min(1), bookingId: z.string().min(1) }).parse(request.params);
    return readBookingHistory(await authenticate(request), bookingId, businessId);
  });

  app.get('/v1/bookings/:bookingId/details', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1).max(256) }).parse(request.params);
    return readBookingDetails(await authenticate(request), bookingId);
  });
  app.get('/v1/bookings/:bookingId/calendar', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1).max(256) }).parse(request.params);
    const { revision } = z.strictObject({ revision: z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().nonnegative()) }).parse(request.query);
    return readBookingCalendar(await authenticate(request), bookingId, revision);
  });

  app.get('/v1/me/bookings', async (request) => {
    return { bookings: await listCustomerBookings(await authenticate(request)) };
  });

  app.get('/v1/provider/businesses/:businessId/bookings', async (request) => {
    const params = z.object({ businessId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return { bookings: await listProviderBookings(context) };
  });
}

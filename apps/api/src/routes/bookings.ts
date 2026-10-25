import { publicBusinessWhere } from '../security/business-eligibility.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { BookingStatus, BusinessApprovalStatus, MembershipRole } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { occupiedInterval, assertCapacity, type Interval } from '../scheduling/intervals.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { acquireIntervalLocks } from '../scheduling/redis-slot-lock.js';
import { authenticate } from '../security/sessions.js';
import { requireBusinessMembership, requirePublicBusiness } from '../security/tenant-context.js';
import { containsInterval, workingWindows } from '../scheduling/availability.js';
import { getBusinessAvailability } from '../repositories/availability.js';
import { effectiveWindows } from '../scheduling/rules.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { listCustomerBookings, listProviderBookings } from '../repositories/bookings.js';

const activeStatuses = [BookingStatus.HELD, BookingStatus.CONFIRMED];
const isActiveStatus = (status: BookingStatus) => status === BookingStatus.HELD || status === BookingStatus.CONFIRMED;
const asError = (error: unknown) => error instanceof Error ? error.message : 'Invalid time.';

async function assertWorkingHours(businessId: string, timezone: string, staffId: string, startsAt: Date, occupied: Interval) {
  const zonedStart = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(timezone);
  const localDate = zonedStart.toPlainDate();
  const weekday = zonedStart.dayOfWeek % 7;
  const dateKey = localDate.toString();
  const [businessOverride, businessHours, staffOverride, staffHours] = await Promise.all([
    prisma.scheduleOverride.findFirst({ where: { businessId, date: new Date(`${dateKey}T00:00:00.000Z`) } }),
    prisma.businessWeeklyAvailability.findMany({ where: { businessId, weekday } }),
    prisma.staffScheduleOverride.findFirst({ where: { businessId, staffId, date: new Date(`${dateKey}T00:00:00.000Z`) } }),
    prisma.staffWeeklyAvailability.findMany({ where: { businessId, staffId } }),
  ]);
  const businessWindows = effectiveWindows(businessOverride, businessHours);
  const staffWindows = effectiveWindows(staffOverride, staffHours.length ? staffHours.filter((item) => item.weekday === weekday) : businessWindows);
  const shared = workingWindows(dateKey, timezone, businessWindows, staffWindows);
  if (!containsInterval(shared.intervals, occupied)) throw conflict('The appointment and its buffers must fit inside business and provider working hours.');
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
    const parsed = z.object({ businessId: z.string().min(1), serviceId: z.string().min(1), staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }).optional(), localDate: z.string().date().optional(), localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), utcOffset: z.string().optional(), idempotencyKey: z.string().min(16).max(128) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a service, provider, and valid appointment time.');
    const input = parsed.data;
    if ((!input.startsAt && (!input.localDate || !input.localTime)) || (input.startsAt && (input.localDate || input.localTime || input.utcOffset))) throw new AppError(400, 'VALIDATION_ERROR', 'Provide either an instant or a local date and time.');

    const business = await prisma.business.findFirst({ where: { id: input.businessId, ...publicBusinessWhere }, select: { id: true, timezone: true, bookingPolicy: true } });
    if (!business) throw notFound();
    if (!business.bookingPolicy) throw conflict('This business has not finished setting its booking policy.');
    let startsAt: Date;
    try { startsAt = input.startsAt ? new Date(input.startsAt) : localDateTimeToInstant(input.localDate!, input.localTime!, business.timezone, input.utcOffset); }
    catch (error) { throw new AppError(400, 'INVALID_LOCAL_TIME', asError(error)); }
    if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0) throw new AppError(400, 'INVALID_LOCAL_TIME', 'Appointment starts must be on a whole minute.');
    const now = new Date();
    const policy = business.bookingPolicy;
    const startDateInZone = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate();
    const maximumLocalDate = Temporal.Now.zonedDateTimeISO(business.timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
    if (startsAt.getTime() < now.getTime() + policy.minimumNoticeMinutes * 60_000 || Temporal.PlainDate.compare(startDateInZone, maximumLocalDate) > 0) throw conflict('The requested time is outside this business’s booking window.');

    const [service, staffLink] = await Promise.all([
      prisma.service.findFirst({ where: { id: input.serviceId, businessId: business.id, active: true } }),
      prisma.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId: business.id, staffId: input.staffId, serviceId: input.serviceId } }, include: { staff: true } }),
    ]);
    if (!service || !staffLink?.staff.active) throw notFound();
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    const occupied = occupiedInterval(startsAt, service.durationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
    await assertWorkingHours(business.id, business.timezone, input.staffId, startsAt, occupied);
    if (startsAt.getTime() < now.getTime() + policy.minimumNoticeMinutes * 60_000) throw conflict('The requested time is outside this business’s booking window.');
    const holdExpiresAt = new Date(now.getTime() + 5 * 60_000);
    const matchesRequest = (candidate: { customerId: string; serviceId: string; staffId: string; startsAt: Date }) => candidate.customerId === identity.id && candidate.serviceId === service.id && candidate.staffId === staffLink.staff.id && candidate.startsAt.getTime() === startsAt.getTime();
    const prior = await prisma.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
    if (prior) {
      if (!matchesRequest(prior)) throw conflict('That idempotency key was already used for a different booking request.');
      reply.code(200);
      return { id: prior.id, status: prior.status, startsAt: prior.startsAt.toISOString(), endsAt: prior.endsAt.toISOString(), holdExpiresAt: prior.holdExpiresAt?.toISOString() };
    }
    const slotLock = await acquireLocks(business.id, staffLink.staff.id, occupied);
    if (!slotLock.acquired) throw conflict('That time is being booked. Choose another time or retry shortly.');
    try {
      const booking = await withBookingTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${business.id} FOR SHARE`;
        if (!await tx.business.findFirst({ where: { id: business.id, ...publicBusinessWhere }, select: { id: true } })) throw conflict('This business is not published for bookings.');
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
      reply.code(201);
      return { id: booking.id, status: booking.status, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), holdExpiresAt: booking.holdExpiresAt?.toISOString() };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') throw conflict('Availability changed. Choose another time and retry.');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const existing = await prisma.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
        if (existing && matchesRequest(existing)) {
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
      const result = await tx.booking.updateMany({ where: { id: booking.id, customerId: identity.id, status: BookingStatus.HELD, holdExpiresAt: { gt: new Date() } }, data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null } });
      if (result.count !== 1) throw conflict('This appointment hold has expired. Start again to choose a new time.');
    });
    return { id: booking.id, status: BookingStatus.CONFIRMED };
  });

  app.post('/v1/bookings/:bookingId/reschedule', async (request) => {
    const { identity } = await authenticate(request);
    const params = z.object({ bookingId: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }).optional(), localDate: z.string().date().optional(), localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), utcOffset: z.string().optional() }).safeParse(request.body);
    if (!params.success || !body.success || (!body.data.startsAt && (!body.data.localDate || !body.data.localTime)) || (body.data.startsAt && (body.data.localDate || body.data.localTime || body.data.utcOffset))) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a provider and a valid appointment time.');
    const existing = await prisma.booking.findFirst({ where: { id: params.data.bookingId, customerId: identity.id, status: BookingStatus.CONFIRMED }, include: { business: { include: { bookingPolicy: true } } } });
    if (!existing || (existing.business.approvalStatus !== 'APPROVED' || existing.business.deletedAt)) throw notFound();
    const policy = existing.business.bookingPolicy;
    if (!policy) throw conflict('This business has not finished setting its booking policy.');
    if (existing.startsAt.getTime() < Date.now() + policy.rescheduleCutoffMinutes * 60_000) throw conflict('The reschedule cutoff has passed for this appointment.');
    let startsAt: Date;
    try { startsAt = body.data.startsAt ? new Date(body.data.startsAt) : localDateTimeToInstant(body.data.localDate!, body.data.localTime!, existing.business.timezone, body.data.utcOffset); }
    catch (error) { throw new AppError(400, 'INVALID_LOCAL_TIME', asError(error)); }
    if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0) throw new AppError(400, 'INVALID_LOCAL_TIME', 'Appointment starts must be on a whole minute.');
    const now = new Date();
    const startDateInZone = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(existing.business.timezone).toPlainDate();
    const maximumLocalDate = Temporal.Now.zonedDateTimeISO(existing.business.timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
    if (startsAt.getTime() < now.getTime() + policy.minimumNoticeMinutes * 60_000 || Temporal.PlainDate.compare(startDateInZone, maximumLocalDate) > 0) throw conflict('The requested time is outside this business’s booking window.');
    const staffService = await prisma.staffService.findUnique({ where: { businessId_staffId_serviceId: { businessId: existing.businessId, staffId: body.data.staffId, serviceId: existing.serviceId } }, include: { staff: true } });
    if (!staffService?.staff.active) throw notFound();
    const endsAt = new Date(startsAt.getTime() + existing.serviceDurationMinutes * 60_000);
    const occupied = occupiedInterval(startsAt, existing.serviceDurationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
    await assertWorkingHours(existing.businessId, existing.business.timezone, body.data.staffId, startsAt, occupied);
    const slotLock = await acquireLocks(existing.businessId, staffService.staff.id, occupied);
    if (!slotLock.acquired) throw conflict('That time is being booked. Choose another time or retry shortly.');
    try {
      const updated = await withBookingTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${existing.businessId} FOR SHARE`;
        if (!await tx.business.findFirst({ where: { id: existing.businessId, approvalStatus: 'APPROVED', deletedAt: null }, select: { id: true } })) throw conflict('This business cannot accept rescheduling.');
        if (await tx.timeBlock.count({ where: { businessId: existing.businessId, staffId: staffService.staff.id, startsAt: { lt: occupied.endsAt }, endsAt: { gt: occupied.startsAt } } })) throw conflict('This provider has blocked this time.');
        const conflicts = await tx.booking.findMany({ where: { businessId: existing.businessId, staffId: staffService.staff.id, id: { not: existing.id }, OR: [{ status: BookingStatus.CONFIRMED }, { status: BookingStatus.HELD, holdExpiresAt: { gt: new Date() } }], occupiedFrom: { lt: occupied.endsAt }, occupiedUntil: { gt: occupied.startsAt } }, select: { occupiedFrom: true, occupiedUntil: true } });
        if (!assertCapacity(occupied, conflicts.map((item) => ({ startsAt: item.occupiedFrom, endsAt: item.occupiedUntil })), staffService.staff.parallelCapacity)) throw conflict('That time was just booked. Choose another time.');
        const updated = await tx.booking.updateMany({ where: { id: existing.id, customerId: identity.id, status: BookingStatus.CONFIRMED }, data: { staffId: staffService.staff.id, startsAt, endsAt, occupiedFrom: occupied.startsAt, occupiedUntil: occupied.endsAt } });
        if (updated.count !== 1) throw conflict('This appointment changed before it could be rescheduled.');
        return tx.booking.findUniqueOrThrow({ where: { id: existing.id } });
      });
      return { id: updated.id, status: updated.status, startsAt: updated.startsAt.toISOString(), endsAt: updated.endsAt.toISOString() };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') throw conflict('Availability changed. Choose another time and retry.');
      throw error;
    } finally { await slotLock.release(); }
  });

  app.post('/v1/bookings/:bookingId/cancel', async (request) => {
    const { identity } = await authenticate(request);
    const params = z.object({ bookingId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw notFound();
    const booking = await prisma.booking.findFirst({ where: { id: params.data.bookingId, customerId: identity.id }, include: { business: { include: { bookingPolicy: true } } } });
    if (!booking) throw notFound();
    if (booking.status === BookingStatus.CANCELLED) return { id: booking.id, status: BookingStatus.CANCELLED };
    if (!isActiveStatus(booking.status)) throw conflict('This appointment can no longer be cancelled.');
    const cutoff = booking.business.bookingPolicy?.cancellationCutoffMinutes ?? 0;
    if (booking.status === BookingStatus.CONFIRMED && booking.startsAt.getTime() < Date.now() + cutoff * 60_000) throw conflict('The cancellation cutoff has passed for this appointment.');
    const result = await prisma.booking.updateMany({ where: { id: booking.id, customerId: identity.id, status: booking.status }, data: { status: BookingStatus.CANCELLED, holdExpiresAt: null } });
    if (result.count !== 1) {
      const latest = await prisma.booking.findFirst({ where: { id: booking.id, customerId: identity.id } });
      if (latest?.status === BookingStatus.CANCELLED) return { id: booking.id, status: BookingStatus.CANCELLED };
      throw conflict('This appointment has already changed. Refresh and retry.');
    }
    return { id: booking.id, status: BookingStatus.CANCELLED };
  });

  app.post('/v1/provider/businesses/:businessId/bookings/:bookingId/cancel', async (request) => {
    const params = z.object({ businessId: z.string().min(1), bookingId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const membership = await prisma.membership.findFirst({ where: { identityId: identity.id, businessId: params.data.businessId, role: { in: [MembershipRole.OWNER, MembershipRole.MANAGER] }, status: 'ACTIVE', business: { approvalStatus: BusinessApprovalStatus.APPROVED } } });
    if (!membership) throw notFound();
    const existing = await prisma.booking.findFirst({ where: { id: params.data.bookingId, businessId: params.data.businessId } });
    if (!existing) throw notFound();
    if (existing.status === BookingStatus.CANCELLED) return { id: existing.id, status: BookingStatus.CANCELLED };
    if (!isActiveStatus(existing.status)) throw conflict('This appointment can no longer be cancelled.');
    const result = await prisma.booking.updateMany({ where: { id: existing.id, businessId: params.data.businessId, status: existing.status }, data: { status: BookingStatus.CANCELLED, holdExpiresAt: null } });
    if (result.count !== 1) {
      const latest = await prisma.booking.findFirst({ where: { id: existing.id, businessId: params.data.businessId } });
      if (latest?.status === BookingStatus.CANCELLED) return { id: existing.id, status: BookingStatus.CANCELLED };
      throw conflict('This appointment has already changed. Refresh and retry.');
    }
    return { id: params.data.bookingId, status: BookingStatus.CANCELLED };
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

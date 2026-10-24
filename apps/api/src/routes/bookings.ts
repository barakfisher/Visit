import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { BookingStatus, BusinessApprovalStatus, MembershipRole } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { occupiedInterval, assertCapacity } from '../scheduling/intervals.js';
import { localDateTimeToInstant, possibleLocalInstants } from '../scheduling/local-time.js';
import { acquireIntervalLocks } from '../scheduling/redis-slot-lock.js';
import { authenticate } from '../security/sessions.js';
import { requireBusinessMembership } from '../security/tenant-context.js';
import { effectiveWindows } from '../scheduling/rules.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { listCustomerBookings, listProviderBookings } from '../repositories/bookings.js';

const activeStatuses = [BookingStatus.HELD, BookingStatus.CONFIRMED];
const isActiveStatus = (status: BookingStatus) => status === BookingStatus.HELD || status === BookingStatus.CONFIRMED;
const asError = (error: unknown) => error instanceof Error ? error.message : 'Invalid time.';

async function assertWorkingHours(businessId: string, timezone: string, staffId: string, startsAt: Date, endsAt: Date) {
  const zonedStart = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(timezone);
  const zonedEnd = Temporal.Instant.from(endsAt.toISOString()).toZonedDateTimeISO(timezone);
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
  const localStartTime = zonedStart.toPlainTime().toString({ smallestUnit: 'minute' });
  const localEndTime = zonedEnd.toPlainTime().toString({ smallestUnit: 'minute' });
  const contained = (items: { startLocal: string; endLocal: string }[]) => items.some(({ startLocal, endLocal }) => localDate.equals(zonedEnd.toPlainDate()) && localStartTime >= startLocal && localEndTime <= endLocal);
  if (!contained(businessWindows) || !contained(staffWindows)) throw conflict('This time is outside the business or provider’s working hours.');
}

export async function registerBookingRoutes(app: FastifyInstance, { acquireLocks = acquireIntervalLocks }: { acquireLocks?: typeof acquireIntervalLocks } = {}) {
  app.get('/v1/businesses', async () => {
    const businesses = await prisma.business.findMany({ where: { approvalStatus: BusinessApprovalStatus.APPROVED, services: { some: { active: true } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, timezone: true } });
    return { businesses };
  });

  app.get('/v1/businesses/:businessId/availability', async (request) => {
    const params = z.object({ businessId: z.string().min(1) }).safeParse(request.params);
    const query = z.object({ serviceId: z.string().min(1), date: z.string().date(), includeUnavailable: z.enum(['true']).optional() }).safeParse(request.query);
    if (!params.success || !query.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a business, service, and local date.');
    const business = await prisma.business.findFirst({ where: { id: params.data.businessId, approvalStatus: BusinessApprovalStatus.APPROVED }, include: { bookingPolicy: true } });
    if (!business) throw notFound();
    if (!business.bookingPolicy) throw conflict('This business has not finished setting its booking policy.');
    const service = await prisma.service.findFirst({ where: { id: query.data.serviceId, businessId: business.id, active: true } });
    if (!service) throw notFound();
    const date = Temporal.PlainDate.from(query.data.date);
    const weekday = date.dayOfWeek % 7;
    const dateValue = new Date(`${query.data.date}T00:00:00.000Z`);
    const [businessOverride, businessHours, staffLinks] = await Promise.all([
      prisma.scheduleOverride.findFirst({ where: { businessId: business.id, date: dateValue } }),
      prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id, weekday }, orderBy: { startLocal: 'asc' } }),
      prisma.staffService.findMany({ where: { businessId: business.id, serviceId: service.id, staff: { active: true } }, include: { staff: true } }),
    ]);
    const businessWindows = effectiveWindows(businessOverride, businessHours);
    if (!businessWindows.length) return { timezone: business.timezone, service: { id: service.id, durationMinutes: service.durationMinutes }, slots: [] };
    const dayStart = new Date(Number(date.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).toInstant().epochMilliseconds));
    const dayEnd = new Date(Number(date.add({ days: 1 }).toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).toInstant().epochMilliseconds));
    const slots: { startsAt: string; localTime: string; utcOffset: string; staffId: string; staffName: string; available: boolean; locked: boolean }[] = [];
    const now = new Date();
    const { minimumNoticeMinutes, maximumAdvanceDays, bufferBeforeMinutes, bufferAfterMinutes } = business.bookingPolicy;
    const maximumLocalDate = Temporal.Now.zonedDateTimeISO(business.timezone).toPlainDate().add({ days: maximumAdvanceDays });
    for (const { staff } of staffLinks) {
      const [staffOverride, configuredStaffHours, existing, blocks] = await Promise.all([
        prisma.staffScheduleOverride.findFirst({ where: { businessId: business.id, staffId: staff.id, date: dateValue } }),
        prisma.staffWeeklyAvailability.findMany({ where: { businessId: business.id, staffId: staff.id }, orderBy: { startLocal: 'asc' } }),
        prisma.booking.findMany({ where: { businessId: business.id, staffId: staff.id, occupiedFrom: { lt: new Date(dayEnd.getTime() + bufferBeforeMinutes * 60_000) }, occupiedUntil: { gt: new Date(dayStart.getTime() - bufferAfterMinutes * 60_000) }, OR: [{ status: BookingStatus.CONFIRMED }, { status: BookingStatus.HELD, holdExpiresAt: { gt: now } }] }, select: { occupiedFrom: true, occupiedUntil: true, status: true } }),
        prisma.timeBlock.findMany({ where: { businessId: business.id, staffId: staff.id, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } } }),
      ]);
      const staffWindows = effectiveWindows(staffOverride, configuredStaffHours.length ? configuredStaffHours.filter((item) => item.weekday === weekday) : businessWindows);
      const sharedWindows = businessWindows.flatMap((businessWindow) => staffWindows.flatMap((staffWindow) => {
        const startLocal = businessWindow.startLocal > staffWindow.startLocal ? businessWindow.startLocal : staffWindow.startLocal;
        const endLocal = businessWindow.endLocal < staffWindow.endLocal ? businessWindow.endLocal : staffWindow.endLocal;
        return startLocal < endLocal ? [{ startLocal, endLocal }] : [];
      }));
      for (const window of sharedWindows) {
        const startParts = window.startLocal.split(':').map(Number);
        const endParts = window.endLocal.split(':').map(Number);
        const from = Number(startParts[0]) * 60 + Number(startParts[1]);
        const until = Number(endParts[0]) * 60 + Number(endParts[1]);
        for (let minute = from; minute + service.durationMinutes <= until; minute += 15) {
          const localTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
          for (const startsAt of possibleLocalInstants(query.data.date, localTime, business.timezone)) {
            const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
            if (startsAt < new Date(now.getTime() + minimumNoticeMinutes * 60_000) || Temporal.PlainDate.compare(date, maximumLocalDate) > 0) continue;
            const occupied = occupiedInterval(startsAt, service.durationMinutes, bufferBeforeMinutes, bufferAfterMinutes);
            const available = assertCapacity(occupied, existing.map((booking) => ({ startsAt: booking.occupiedFrom, endsAt: booking.occupiedUntil })), staff.parallelCapacity) && !blocks.some((block) => block.startsAt < occupied.endsAt && block.endsAt > occupied.startsAt);
            if (!available && !query.data.includeUnavailable) continue;
            const zoned = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(business.timezone);
            const zonedEnd = Temporal.Instant.from(endsAt.toISOString()).toZonedDateTimeISO(business.timezone);
            if (!date.equals(zonedEnd.toPlainDate())) continue;
            if (!sharedWindows.some((hours) => zoned.toPlainTime().toString({ smallestUnit: 'minute' }) >= hours.startLocal && zonedEnd.toPlainTime().toString({ smallestUnit: 'minute' }) <= hours.endLocal)) continue;
            slots.push({ startsAt: startsAt.toISOString(), localTime, utcOffset: zoned.offset, staffId: staff.id, staffName: staff.displayName, available, locked: !available && existing.some((booking) => booking.status === BookingStatus.HELD && booking.occupiedFrom < occupied.endsAt && booking.occupiedUntil > occupied.startsAt) });
          }
        }
      }
    }
    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.staffName.localeCompare(b.staffName));
    return { timezone: business.timezone, service: { id: service.id, durationMinutes: service.durationMinutes }, slots };
  });

  app.post('/v1/bookings', async (request, reply) => {
    const { identity } = await authenticate(request);
    const parsed = z.object({ businessId: z.string().min(1), serviceId: z.string().min(1), staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }).optional(), localDate: z.string().date().optional(), localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), utcOffset: z.string().optional(), idempotencyKey: z.string().min(16).max(128) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a service, provider, and valid appointment time.');
    const input = parsed.data;
    if ((!input.startsAt && (!input.localDate || !input.localTime)) || (input.startsAt && (input.localDate || input.localTime || input.utcOffset))) throw new AppError(400, 'VALIDATION_ERROR', 'Provide either an instant or a local date and time.');

    const business = await prisma.business.findFirst({ where: { id: input.businessId, approvalStatus: BusinessApprovalStatus.APPROVED }, select: { id: true, timezone: true, bookingPolicy: true } });
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
    await assertWorkingHours(business.id, business.timezone, input.staffId, startsAt, endsAt);
    const occupied = occupiedInterval(startsAt, service.durationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
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
        const existing = await tx.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
        if (existing) {
          if (!matchesRequest(existing)) throw conflict('That idempotency key was already used for a different booking request.');
          return existing;
        }
        await tx.booking.updateMany({ where: { businessId: business.id, staffId: input.staffId, status: BookingStatus.HELD, holdExpiresAt: { lte: now } }, data: { status: BookingStatus.EXPIRED } });
        const conflicts = await tx.booking.findMany({ where: { businessId: business.id, staffId: input.staffId, status: { in: activeStatuses }, occupiedFrom: { lt: occupied.endsAt }, occupiedUntil: { gt: occupied.startsAt } }, select: { occupiedFrom: true, occupiedUntil: true } });
        if (!assertCapacity(occupied, conflicts.map((item) => ({ startsAt: item.occupiedFrom, endsAt: item.occupiedUntil })), staffLink.staff.parallelCapacity)) throw conflict('That time was just booked. Choose another time.');
        if (await tx.timeBlock.count({ where: { businessId: business.id, staffId: input.staffId, startsAt: { lt: occupied.endsAt }, endsAt: { gt: occupied.startsAt } } })) throw conflict('This provider has blocked this time. Choose another time.');
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
    const result = await prisma.booking.updateMany({ where: { id: booking.id, customerId: identity.id, status: BookingStatus.HELD, holdExpiresAt: { gt: new Date() } }, data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null } });
    if (result.count !== 1) throw conflict('This appointment hold has expired. Start again to choose a new time.');
    return { id: booking.id, status: BookingStatus.CONFIRMED };
  });

  app.post('/v1/bookings/:bookingId/reschedule', async (request) => {
    const { identity } = await authenticate(request);
    const params = z.object({ bookingId: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }).optional(), localDate: z.string().date().optional(), localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), utcOffset: z.string().optional() }).safeParse(request.body);
    if (!params.success || !body.success || (!body.data.startsAt && (!body.data.localDate || !body.data.localTime)) || (body.data.startsAt && (body.data.localDate || body.data.localTime || body.data.utcOffset))) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a provider and a valid appointment time.');
    const existing = await prisma.booking.findFirst({ where: { id: params.data.bookingId, customerId: identity.id, status: BookingStatus.CONFIRMED }, include: { business: { include: { bookingPolicy: true } }, service: true } });
    if (!existing) throw notFound();
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
    const endsAt = new Date(startsAt.getTime() + existing.service.durationMinutes * 60_000);
    await assertWorkingHours(existing.businessId, existing.business.timezone, body.data.staffId, startsAt, endsAt);
    const occupied = occupiedInterval(startsAt, existing.service.durationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
    const slotLock = await acquireLocks(existing.businessId, staffService.staff.id, occupied);
    if (!slotLock.acquired) throw conflict('That time is being booked. Choose another time or retry shortly.');
    try {
      const updated = await withBookingTransaction(async (tx) => {
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

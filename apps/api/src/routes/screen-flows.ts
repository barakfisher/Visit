import { runBookingAttempt } from '../scheduling/booking-attempts.service.js';
import { reviewedServiceSchema } from '../scheduling/booking-consent.utils.js';
import { publicBusinessWhere } from '../security/business-eligibility.js';
import { withBusinessConfiguration } from '../repositories/publication.js';
import { requireOwnedReschedule } from '../security/tenant-context.js';
import { getBusinessAvailability, getBusinessBookingCalendar } from '../repositories/availability.js';
import type { FastifyInstance, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { parseService } from '../repositories/services.js';
import { bookingServiceSnapshot } from '../repositories/bookings.js';
import { prisma } from '../db/client.js';
import { authenticate } from '../security/sessions.js';
import { requirePublicBusiness, requireBusinessMembership } from '../security/tenant-context.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { requireHold, releaseHold } from '../scheduling/reservations.js';
import { acquireIntervalLocks } from '../scheduling/redis-slot-lock.js';
import { localDateTimeToInstant } from '../scheduling/local-time.js';
import { withBookingTransaction } from '../scheduling/booking-transaction.js';
import { listCustomerBookings } from '../repositories/bookings.js';

// Compatibility boundary: reuse the existing validated, tenant-scoped v1 handlers.
async function invoke(app: FastifyInstance, request: FastifyRequest, method: HTTPMethods, url: string, payload?: unknown) {
  const response = await app.inject({ method, url, headers: { ...(request.headers.origin ? { origin: request.headers.origin } : {}), ...(request.headers['sec-fetch-site'] ? { 'sec-fetch-site': request.headers['sec-fetch-site'] } : {}), ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}), 'x-visit-client': request.headers['x-visit-client'] as string ?? 'web' }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const body = response.json();
  if (response.statusCode >= 400) throw new AppError(response.statusCode, body.error?.code ?? 'REQUEST_FAILED', body.error?.message ?? 'Request failed.', body.error?.fields);
  return body;
}
async function providerContext(request: FastifyRequest, supplied?: string) {
  const { identity } = await authenticate(request);
  let businessId = supplied;
  if (!businessId) {
    const memberships = await prisma.membership.findMany({ where: { identityId: identity.id, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] }, business: { approvalStatus: 'APPROVED' } }, select: { businessId: true } });
    if (memberships.length !== 1) throw new AppError(400, 'CHOOSE_BUSINESS', 'Choose the business you want to manage.');
    businessId = memberships[0]!.businessId;
  }
  await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  if (business.approvalStatus !== 'APPROVED') throw notFound();
  return { businessId, business, identity };
}
export async function registerScreenFlows(app: FastifyInstance) {
  app.get('/api/bookings/:bookingId/provider', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1) }).parse(request.params);
    const { context, serviceId, booking } = await requireOwnedReschedule(await authenticate(request), bookingId);
    const provider = await prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { id: true, name: true, timezone: true, location: true, category: true, services: { where: { id: serviceId } }, weeklyAvailability: true, scheduleOverrides: true, bookingPolicy: true } });
    return { revision: booking.revision, provider: { ...provider, services: provider.services.map(service => ({ ...service, name: booking.serviceName, durationMinutes: booking.serviceDurationMinutes, priceMinor: booking.servicePriceMinor, currency: booking.serviceCurrency })) } };
  });
  app.get('/api/bookings/:bookingId/availability', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1) }).parse(request.params);
    const { date } = z.object({ date: z.string().date() }).parse(request.query);
    const { context, serviceId } = await requireOwnedReschedule(await authenticate(request), bookingId);
    return getBusinessAvailability(context, serviceId, date, true);
  });
  app.get('/api/providers/:providerId/booking-calendar', async request => {
    const { providerId } = z.object({ providerId: z.string().min(1) }).parse(request.params);
    const { serviceId, fromDate, days } = z.strictObject({ serviceId: z.string().min(1), fromDate: z.string().date(), days: z.coerce.number().int().min(1).max(31).default(31) }).parse(request.query);
    return getBusinessBookingCalendar(await requirePublicBusiness(providerId), serviceId, fromDate, days);
  });
  app.get('/api/bookings/:bookingId/booking-calendar', async request => {
    const { bookingId } = z.object({ bookingId: z.string().min(1) }).parse(request.params);
    const { fromDate, days } = z.strictObject({ fromDate: z.string().date(), days: z.coerce.number().int().min(1).max(31).default(31) }).parse(request.query);
    const { context, serviceId } = await requireOwnedReschedule(await authenticate(request), bookingId);
    return getBusinessBookingCalendar(context, serviceId, fromDate, days);
  });
  app.get('/api/providers/:providerId', async (request) => {
    const { providerId } = request.params as { providerId: string };
    const provider = await prisma.business.findFirst({ where: { id: providerId, ...publicBusinessWhere }, select: { id: true, name: true, timezone: true, location: true, category: true, description: true, contactEmail: true, contactPhone: true, services: { where: { active: true }, orderBy: { name: 'asc' } }, weeklyAvailability: true, scheduleOverrides: true, bookingPolicy: true } });
    if (!provider) throw notFound();
    return { provider };
  });
  app.get('/api/providers/:providerId/availability', async (request) => {
    const { providerId } = request.params as { providerId: string };
    const query = z.object({ serviceId: z.string().min(1), date: z.string().date() }).parse(request.query);
    return invoke(app, request, 'GET', `/v1/businesses/${encodeURIComponent(providerId)}/availability?${new URLSearchParams({ ...query, includeUnavailable: 'true' })}`);
  });
  app.get('/api/consumer/bookings/active', async (request) => {
    return { bookings: await listCustomerBookings(await authenticate(request), true) };
  });
  app.get('/api/bookings/attempts', async request => {
    const { identity } = await authenticate(request);
    const { businessId, key } = z.strictObject({ businessId: z.string().min(1), key: z.string().min(16).max(128) }).parse(request.query);
    const booking = await prisma.booking.findFirst({ where: { businessId, idempotencyKey: key, customerId: identity.id }, select: { id: true, status: true } });
    if (booking?.status === 'CONFIRMED' || booking?.status === 'CANCELLED' || booking?.status === 'EXPIRED') return booking;
    const attempt = await prisma.bookingAttempt.findFirst({ where: { businessId, idempotencyKey: key, customerId: identity.id }, select: { id: true, status: true } });
    if (attempt?.status === 'REJECTED') return { id: booking?.id ?? attempt.id, status: 'EXPIRED' };
    if (booking) return booking;
    if (attempt) return { id: attempt.id, status: 'PENDING' };
    throw notFound();
  });
  app.post('/api/bookings/commit', async request => {
    const { identity } = await authenticate(request);
    const input = z.strictObject({ finalConsent: z.literal(true), reviewedService: reviewedServiceSchema, providerId: z.string().min(1), serviceId: z.string().min(1), staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }), idempotencyKey: z.string().min(16).max(128) }).parse(request.body);
    return runBookingAttempt(input, identity.id, async () => {
      const { providerId, ...rest } = input;
      const attempt = z.object({ id: z.string(), status: z.string() }).parse(await invoke(app, request, 'POST', '/v1/bookings', { ...rest, businessId: providerId }));
      return attempt.status === 'CONFIRMED' ? attempt : z.object({ id: z.string(), status: z.literal('CONFIRMED') }).parse(await invoke(app, request, 'POST', `/v1/bookings/${encodeURIComponent(attempt.id)}/confirm`, {}));
    });
  });
  app.post('/api/bookings/lock-slot', async (request, reply) => {
    const { identity } = await authenticate(request);
    const parsed = z.object({ finalConsent: z.literal(true), providerId: z.string().min(1), serviceId: z.string().min(1), staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }), idempotencyKey: z.string().min(16).max(128) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a service and available time.');
    const { providerId, ...input } = parsed.data;
    // Fail closed when Redis is down; do not create a database hold without a reservation service.
    const { ensureRedisReady } = await import('../infra/redis.js');
    try { await ensureRedisReady(); } catch { throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable.'); }
    const result = await invoke(app, request, 'POST', '/v1/bookings', { ...input, businessId: providerId });
    const booking = await prisma.booking.findFirstOrThrow({ where: { id: result.id, businessId: providerId, customerId: identity.id }, include: { staff: true } });
    if (booking.status !== 'HELD') throw conflict('This reservation is no longer active.');
    reply.code(201);
    return { holdId: booking.id, expiresAt: booking.holdExpiresAt!.toISOString(), startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString() };
  });
  app.post('/api/bookings/confirm', async (request) => {
    const { identity } = await authenticate(request);
    const input = z.object({ holdId: z.string().min(1), fromBookingId: z.string().optional() }).parse(request.body);
    const booking = await prisma.booking.findFirst({ where: { id: input.holdId, customerId: identity.id } });
    if (!booking) throw notFound();
    if (booking.status === 'CONFIRMED' && !input.fromBookingId) return { id: booking.id, status: 'CONFIRMED' };
    await requireHold(booking.id, identity.id);
    if (input.fromBookingId) throw new AppError(400, 'VALIDATION_ERROR', 'Use the reschedule action for an existing appointment.');
    const confirmed = await invoke(app, request, 'POST', `/v1/bookings/${encodeURIComponent(booking.id)}/confirm`, {});
    await releaseHold(booking.id, identity.id).catch(() => {}); // DB is committed; Redis members also expire independently.
    return confirmed;
  });
  app.post('/api/bookings/:holdId/release', async (request) => {
    const { identity } = await authenticate(request);
    const { holdId } = request.params as { holdId: string };
    await prisma.booking.updateMany({ where: { id: holdId, customerId: identity.id, status: 'HELD' }, data: { status: 'CANCELLED', holdExpiresAt: null } });
    await releaseHold(holdId, identity.id);
    return { released: true };
  });
  app.get('/api/provider/agenda', async (request) => {
    const query = z.object({ businessId: z.string().optional(), date: z.string().date() }).parse(request.query);
    const { businessId, business } = await providerContext(request, query.businessId);
    const day = Temporal.PlainDate.from(query.date);
    const startsAt = new Date(Number(day.toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const endsAt = new Date(Number(day.add({ days: 1 }).toZonedDateTime({ timeZone: business.timezone, plainTime: '00:00' }).epochMilliseconds));
    const [bookings, blocks, staff] = await Promise.all([
      prisma.booking.findMany({ where: { businessId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] }, events: { some: {} }, startsAt: { gte: startsAt, lt: endsAt } }, include: { staff: { select: { displayName: true } } }, orderBy: { startsAt: 'asc' } }),
      prisma.timeBlock.findMany({ where: { businessId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, include: { staff: { select: { displayName: true } } }, orderBy: { startsAt: 'asc' } }),
      prisma.staff.findMany({ where: { businessId, active: true }, select: { id: true, displayName: true } }),
    ]);
    const revenue: Record<string, number> = {};
    bookings.forEach((booking) => { if (['CONFIRMED', 'COMPLETED'].includes(booking.status) && booking.serviceCurrency && booking.servicePriceMinor !== null) revenue[booking.serviceCurrency] = (revenue[booking.serviceCurrency] ?? 0) + booking.servicePriceMinor; });
    return { business: { id: business.id, name: business.name, timezone: business.timezone }, bookings: bookings.map(booking => ({ ...booking, customer: { displayName: booking.customerName, phone: booking.customerPhone, email: booking.customerEmail }, service: bookingServiceSnapshot(booking) })), blocks, staff, summary: { appointments: bookings.filter(booking => booking.status !== 'CANCELLED').length, revenue } };
  });
  app.post('/api/provider/block-time', async (request, reply) => {
    const input = z.object({ businessId: z.string().optional(), staffId: z.string(), date: z.string().date(), startLocal: z.string().regex(/^\d{2}:\d{2}$/), endLocal: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().max(200).optional() }).parse(request.body);
    const { businessId, business } = await providerContext(request, input.businessId);
    const staff = await prisma.staff.findFirst({ where: { id: input.staffId, businessId, active: true } });
    if (!staff) throw notFound();
    let startsAt: Date, endsAt: Date;
    try { startsAt = localDateTimeToInstant(input.date, input.startLocal, business.timezone); endsAt = localDateTimeToInstant(input.date, input.endLocal, business.timezone); } catch { throw new AppError(400, 'VALIDATION_ERROR', 'Choose valid, unambiguous local times.'); }
    if (endsAt <= startsAt) throw new AppError(400, 'VALIDATION_ERROR', 'The end must follow the start.');
    const lock = await acquireIntervalLocks(businessId, staff.id, { startsAt, endsAt });
    if (!lock.acquired) throw conflict('This time is being booked. Retry shortly.');
    try {
      const block = await withBookingTransaction(async (tx) => {
        if (await tx.booking.count({ where: { businessId, staffId: staff.id, occupiedFrom: { lt: endsAt }, occupiedUntil: { gt: startsAt }, OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] } })) throw conflict('This break overlaps an appointment or active hold.');
        return tx.timeBlock.create({ data: { businessId, staffId: staff.id, startsAt, endsAt, reason: input.reason ?? null } });
      });
      reply.code(201); return block;
    } catch (error) { if (typeof error === 'object' && error && 'code' in error && error.code === 'P2034') throw conflict('Availability changed. Try again.'); throw error; }
    finally { await lock.release(); }
  });
  app.delete('/api/provider/block-time/:blockId', async (request) => {
    const query = z.object({ businessId: z.string().optional() }).parse(request.query);
    const { businessId } = await providerContext(request, query.businessId);
    const { blockId } = request.params as { blockId: string };
    const result = await prisma.timeBlock.deleteMany({ where: { id: blockId, businessId } });
    if (!result.count) throw notFound();
    return { deleted: true };
  });
  app.post('/api/provider/services', async (request, reply) => {
    const { businessId, identity } = await providerContext(request, (request.query as { businessId?: string }).businessId);
    const body = z.object({ staffIds: z.array(z.string().min(1)).min(1).max(100) }).passthrough().parse(request.body);
    const { staffIds: assigned, ...fields } = body;
    const input = parseService(fields);
    if ('active' in input) throw new AppError(400, 'VALIDATION_ERROR', 'New services start active.');
    const staffIds = [...new Set(assigned)];
    if (await prisma.staff.count({ where: { businessId, id: { in: staffIds }, active: true } }) !== staffIds.length) throw notFound();
    const service = await withBusinessConfiguration(await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']), async (tx) => {
      const service = await tx.service.create({ data: { businessId, name: input.name.trim(), description: input.description?.trim() ?? null, durationMinutes: input.durationMinutes, priceMinor: input.priceMinor ?? null, currency: input.currency ?? null } });
      await tx.staffService.createMany({ data: staffIds.map((staffId) => ({ businessId, staffId, serviceId: service.id })) });
      return service;
    });
    reply.code(201); return service;
  });
  for (const [method, path, suffix] of [['GET', '/api/provider/services', 'services'], ['GET', '/api/provider/working-hours', 'availability-rules'], ['PUT', '/api/provider/working-hours', 'availability-rules']] as const) {
    app.route({ method, url: path, handler: async (request) => {
      const { businessId } = await providerContext(request, (request.query as { businessId?: string }).businessId);
      return invoke(app, request, method, `/v1/provider/businesses/${encodeURIComponent(businessId)}/${suffix}`, method === 'GET' ? undefined : request.body);
    } });
  }
}

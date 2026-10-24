import type { FastifyInstance, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../db/client.js';
import { authenticate } from '../security/sessions.js';
import { requireBusinessMembership } from '../security/tenant-context.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { reserveHold, requireHold, releaseHold } from '../scheduling/reservations.js';
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
  app.get('/api/providers', async (request) => {
    const query = z.object({ search: z.string().max(120).optional(), category: z.string().max(120).optional() }).parse(request.query);
    const all = await prisma.business.findMany({ where: { approvalStatus: 'APPROVED', services: { some: { active: true } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, timezone: true, location: true, category: true } });
    const search = query.search?.trim().toLocaleLowerCase();
    const providers = all.filter((provider) => (!search || [provider.name, provider.location, provider.category].some((value) => value?.toLocaleLowerCase().includes(search))) && (!query.category || query.category === 'All' || provider.category === query.category)).map((provider) => ({ ...provider, rating: null }));
    return { providers, total: all.length, categories: [...new Set(all.map((provider) => provider.category))] };
  });
  app.get('/api/providers/:providerId', async (request) => {
    const { providerId } = request.params as { providerId: string };
    const provider = await prisma.business.findFirst({ where: { id: providerId, approvalStatus: 'APPROVED' }, select: { id: true, name: true, timezone: true, location: true, category: true, services: { where: { active: true }, orderBy: { name: 'asc' } }, weeklyAvailability: true, scheduleOverrides: true, bookingPolicy: true } });
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
  app.post('/api/bookings/lock-slot', async (request, reply) => {
    const { identity } = await authenticate(request);
    const parsed = z.object({ providerId: z.string().min(1), serviceId: z.string().min(1), staffId: z.string().min(1), startsAt: z.string().datetime({ offset: true }), idempotencyKey: z.string().min(16).max(128) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a service and available time.');
    const { providerId, ...input } = parsed.data;
    // Fail closed when Redis is down; do not create a database hold without a reservation service.
    const { ensureRedisReady } = await import('../infra/redis.js');
    try { await ensureRedisReady(); } catch { throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable.'); }
    const result = await invoke(app, request, 'POST', '/v1/bookings', { ...input, businessId: providerId });
    const booking = await prisma.booking.findFirstOrThrow({ where: { id: result.id, businessId: providerId, customerId: identity.id }, include: { staff: true } });
    if (booking.status !== 'HELD') throw conflict('This reservation is no longer active.');
    try { await reserveHold(booking, booking.staff.parallelCapacity); }
    catch (error) { await prisma.booking.updateMany({ where: { id: booking.id, customerId: identity.id, status: 'HELD' }, data: { status: 'CANCELLED', holdExpiresAt: null } }); throw error; }
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
      prisma.booking.findMany({ where: { businessId, status: 'CONFIRMED', startsAt: { gte: startsAt, lt: endsAt } }, include: { service: { select: { name: true, priceMinor: true, currency: true } }, staff: { select: { displayName: true } }, customer: { select: { phone: true, email: true } } }, orderBy: { startsAt: 'asc' } }),
      prisma.timeBlock.findMany({ where: { businessId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, include: { staff: { select: { displayName: true } } }, orderBy: { startsAt: 'asc' } }),
      prisma.staff.findMany({ where: { businessId, active: true }, select: { id: true, displayName: true } }),
    ]);
    const revenue: Record<string, number> = {};
    bookings.forEach((booking) => { if (booking.service.currency && booking.service.priceMinor !== null) revenue[booking.service.currency] = (revenue[booking.service.currency] ?? 0) + booking.service.priceMinor; });
    return { business: { id: business.id, name: business.name, timezone: business.timezone }, bookings, blocks, staff, summary: { appointments: bookings.length, revenue } };
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
        if (await tx.booking.count({ where: { businessId, staffId: staff.id, occupiedFrom: { lt: endsAt }, occupiedUntil: { gt: startsAt }, OR: [{ status: 'CONFIRMED' }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] } })) throw conflict('This break overlaps an appointment or active hold.');
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
    const { businessId } = await providerContext(request, (request.query as { businessId?: string }).businessId);
    const input = z.object({ name: z.string().trim().min(2).max(120), durationMinutes: z.number().int().min(5).max(1440), priceMinor: z.number().int().min(0).max(2000000000).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), staffIds: z.array(z.string()).min(1).max(100) }).parse(request.body);
    if (input.priceMinor !== undefined && !input.currency) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a currency for this price.');
    const staffIds = [...new Set(input.staffIds)];
    if (await prisma.staff.count({ where: { businessId, id: { in: staffIds }, active: true } }) !== staffIds.length) throw notFound();
    const service = await prisma.$transaction(async (tx) => {
      const service = await tx.service.create({ data: { businessId, name: input.name, durationMinutes: input.durationMinutes, priceMinor: input.priceMinor ?? null, currency: input.currency ?? null } });
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

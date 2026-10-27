import { runBookingAttempt } from '../src/scheduling/booking-attempts.service.js';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { tokenDigest } from '../src/security/sessions.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { localDateTimeToInstant } from '../src/scheduling/local-time.js';
import { requireHold, releaseHold, reserveHold } from '../src/scheduling/reservations.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });

test('final consent owns one recoverable booking attempt across both HTTP surfaces', async t => {
  const suffix = randomUUID(), tokens = [randomUUID(), randomUUID()];
  const business = await prisma.business.create({ data: { name: 'Consent fixture', slug: `consent-${suffix}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const people = await Promise.all(['a', 'b'].map(label => prisma.identity.create({ data: { email: `consent-${label}-${suffix}@example.test` } })));
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Reviewed visit', durationMinutes: 30, priceMinor: 12000, currency: 'ILS' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Consent provider', parallelCapacity: 1 } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 5, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '08:00', endLocal: '18:00' })) });
  await prisma.session.createMany({ data: people.map((person, index) => ({ identityId: person.id, tokenHash: tokenDigest(tokens[index] ?? ''), expiresAt: new Date(Date.now() + 600000) })) });
  const headers = (index = 0) => ({ authorization: `Bearer ${tokens[index]}`, 'x-visit-client': 'native' });
  let index = 3;
  const input = () => { const date = new Date(Date.now() + index++ * 86400000).toISOString().slice(0, 10); return { finalConsent: true, providerId: business.id, serviceId: service.id, staffId: staff.id, startsAt: localDateTimeToInstant(date, '11:00', business.timezone).toISOString(), idempotencyKey: randomUUID(), reviewedService: { name: service.name, durationMinutes: service.durationMinutes, priceMinor: service.priceMinor, currency: service.currency } }; };
  async function server(failLocks = false) {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INVALID', message: error instanceof Error ? error.message : 'Request failed.' } }));
    await registerBookingRoutes(app, failLocks ? { acquireLocks: async () => { throw new AppError(503, 'LOCK_UNAVAILABLE', 'Synthetic unavailable transport.'); } } : {});
    await registerScreenFlows(app); return app;
  }
  let app = await server();
  const commit = (payload: ReturnType<typeof input>, actor = 0) => app.inject({ method: 'POST', url: '/api/bookings/commit', headers: headers(actor), payload });
  const hold = (payload: ReturnType<typeof input>) => { const { providerId, ...rest } = payload; return app.inject({ method: 'POST', url: '/v1/bookings', headers: headers(), payload: { ...rest, businessId: providerId } }); };
  try {
    await t.test('browsing and omitted/forged consent create no durable hold on either surface', async () => {
      const payload = input(), date = payload.startsAt.slice(0, 10);
      assert.equal((await app.inject({ url: `/api/providers/${business.id}/availability?serviceId=${service.id}&date=${date}` })).statusCode, 200);
      const before = await prisma.booking.count({ where: { businessId: business.id } });
      for (const finalConsent of [undefined, false, 'true']) {
        for (const url of ['/api/bookings/commit', '/api/bookings/lock-slot', '/v1/bookings']) {
          const { providerId, ...rest } = payload;
          const body = url === '/v1/bookings' ? { ...rest, businessId: providerId, finalConsent } : { ...payload, finalConsent };
          assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: body })).statusCode, 400);
        }
      }
      assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), before);
    });
    await t.test('commit is idempotent and private recovery survives response loss and server restart', async () => {
      const payload = input();
      const first = await commit(payload); assert.equal(first.statusCode, 200, first.body);
      const id = first.json().id;
      await app.close(); app = await server();
      const repeated = await commit(payload); assert.equal(repeated.statusCode, 200); assert.equal(repeated.json().id, id);
      const path = `/api/bookings/attempts?businessId=${business.id}&key=${payload.idempotencyKey}`;
      assert.deepEqual((await app.inject({ url: path, headers: headers() })).json(), { id, status: 'CONFIRMED' });
      assert.equal((await app.inject({ url: path, headers: headers(1) })).statusCode, 404);
      assert.equal((await commit(payload, 1)).statusCode, 404);
      assert.equal((await commit({ ...payload, startsAt: new Date(new Date(payload.startsAt).getTime() + 60000).toISOString() })).statusCode, 409);
      await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } });
      assert.equal((await commit(payload)).json().id, id);
      const { providerId, startsAt: _startsAt, ...local } = payload;
      const legacy = await app.inject({ method: 'POST', url: '/v1/bookings', headers: headers(), payload: { ...local, businessId: providerId, localDate: payload.startsAt.slice(0, 10), localTime: '11:00' } });
      assert.equal(legacy.statusCode, 200, legacy.body); assert.equal(legacy.json().id, id);
      await prisma.business.update({ where: { id: business.id }, data: { publishedAt: new Date() } });
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: payload.idempotencyKey } }), 1);
    });
    await t.test('a worker crash after provisional persistence resumes the same bounded attempt', async () => {
      const payload = input(), provisional = await hold(payload); assert.equal(provisional.statusCode, 201, provisional.body);
      const before = await prisma.booking.findUniqueOrThrow({ where: { id: provisional.json().id } });
      await requireHold(before.id, people[0]?.id ?? '');
      await app.close(); app = await server();
      const result = await commit(payload); assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().id, before.id);
      assert.equal(await redis.get(`visit:hold:${before.id}`), null);
    });
    await t.test('concurrent final attempts cannot exceed capacity and repeated taps share one outcome', async () => {
      const payload = input();
      const results = await Promise.all([commit(payload), commit({ ...payload, idempotencyKey: randomUUID() }, 1)]);
      assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, startsAt: new Date(payload.startsAt), status: 'CONFIRMED' } }), 1);
      const repeated = input(); const taps = await Promise.all([commit(repeated), commit(repeated)]);
      assert.equal(taps.filter(result => result.statusCode === 200).length >= 1, true);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: repeated.idempotencyKey, status: 'CONFIRMED' } }), 1);
    });
    await t.test('foreign release, partial Redis loss and expired ownership cannot confirm via legacy routes', async () => {
      const payload = input(), provisional = await hold(payload), id = provisional.json().id;
      assert.equal(provisional.statusCode, 201, provisional.body);
      await releaseHold(id, people[1]?.id ?? ''); await requireHold(id, people[0]?.id ?? '');
      const raw = await redis.get(`visit:hold:${id}`); assert.ok(raw);
      const metadata: { keys: string[] } = JSON.parse(raw);
      const key = metadata.keys[0]; assert.ok(key);
      await redis.zrem(key, id);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${id}/confirm`, headers: headers(), payload: {} })).statusCode, 409);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
      assert.ok(row.customerId);
      await reserveHold({ ...row, customerId: row.customerId }, 1);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id } })).holdExpiresAt?.getTime(), row.holdExpiresAt?.getTime());
      await prisma.booking.update({ where: { id }, data: { holdExpiresAt: new Date(Date.now() - 1) } });
      assert.equal((await commit(payload)).statusCode, 409);
      assert.equal(await prisma.booking.count({ where: { id, status: 'CONFIRMED' } }), 0);
    });
    await t.test('stale reviewed prices and changed policies or hours fail authoritative confirmation', async () => {
      const payload = input();
      assert.equal((await commit({ ...payload, idempotencyKey: randomUUID(), reviewedService: { ...payload.reviewedService, priceMinor: 1 } })).statusCode, 409);
      const provisional = await hold(payload), id = provisional.json().id; assert.equal(provisional.statusCode, 201, provisional.body);
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { bufferBeforeMinutes: 10 } });
      assert.equal((await commit(payload)).statusCode, 409);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id } })).status, 'EXPIRED');
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { bufferBeforeMinutes: 5 } });
      const next = input(), pending = await hold(next); assert.equal(pending.statusCode, 201, pending.body);
      const day = new Date(next.startsAt.slice(0, 10) + 'T00:00Z');
      await prisma.scheduleOverride.create({ data: { businessId: business.id, date: day, isOpen: false } });
      assert.equal((await commit(next)).statusCode, 409);
    });
    await t.test('service changes reject an unfinished attempt and release its provisional capacity', async () => {
      const payload = input(), provisional = await hold(payload); assert.equal(provisional.statusCode, 201, provisional.body);
      await prisma.service.update({ where: { id: service.id }, data: { name: 'Changed after review' } });
      assert.equal((await commit(payload)).statusCode, 409);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: provisional.json().id } })).status, 'EXPIRED');
      assert.equal(await redis.get(`visit:hold:${provisional.json().id}`), null);
      await prisma.service.update({ where: { id: service.id }, data: { name: service.name } });
    });
    await t.test('orchestration ownership survives work beyond the former transaction timeout', async () => {
      const payload = input();
      let entered!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      const original = runBookingAttempt(payload, people[0]?.id ?? '', async () => {
        entered(); await wait;
        const provisional = await hold(payload); assert.equal(provisional.statusCode, 201, provisional.body);
        const confirmed = await app.inject({ method: 'POST', url: `/v1/bookings/${provisional.json().id}/confirm`, headers: headers(), payload: {} });
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        return { id: provisional.json().id, status: 'CONFIRMED' };
      });
      const result = original.then(value => ({ value, error: null }), error => ({ value: null, error }));
      await ready;
      try {
        await new Promise(resolve => setTimeout(resolve, 21000));
        const retry = await commit(payload); assert.equal(retry.statusCode, 409); assert.equal(retry.json().error.code, 'ATTEMPT_PENDING');
        const recovered = await app.inject({ url: `/api/bookings/attempts?businessId=${business.id}&key=${payload.idempotencyKey}`, headers: headers() });
        assert.equal(recovered.json().status, 'PENDING');
        assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: payload.idempotencyKey } }), 0);
      } finally { release(); }
      const completed = await result; assert.equal(completed.error, null); assert.equal(completed.value?.status, 'CONFIRMED');
      assert.equal((await commit(payload)).json().id, completed.value?.id);
    });
    await t.test('a durable rejection fences late workers and legacy persistence', async () => {
      const payload = input();
      const rejected = await commit({ ...payload, reviewedService: { ...payload.reviewedService, priceMinor: 1 } }); assert.equal(rejected.statusCode, 409);
      const ledger = await prisma.bookingAttempt.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: payload.idempotencyKey } } });
      assert.equal(ledger.status, 'REJECTED');
      assert.equal((await hold(payload)).statusCode, 409);
      const startsAt = new Date(payload.startsAt), endsAt = new Date(startsAt.getTime() + 1800000);
      await assert.rejects(prisma.booking.create({ data: { businessId: business.id, customerId: people[0]?.id ?? '', staffId: staff.id, serviceId: service.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: payload.idempotencyKey, status: 'CONFIRMED' } }), error => error instanceof Error && error.message.includes('VISIT_ATTEMPT_REJECTED'));
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: payload.idempotencyKey } }), 0);
    });
    await t.test('reservation transport failure writes no new booking or success', async () => {
      await app.close(); app = await server(true);
      const payload = input(), result = await commit(payload);
      assert.equal(result.statusCode, 503, result.body);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: payload.idempotencyKey } }), 0);
    });
  } finally {
    await app.close();
    const rows = await prisma.booking.findMany({ where: { businessId: business.id }, select: { id: true, customerId: true } });
    await Promise.allSettled(rows.filter(row => row.customerId !== null).map(row => { assert.ok(row.customerId); return releaseHold(row.id, row.customerId); }));
    await prisma.booking.deleteMany({ where: { businessId: business.id } }); await prisma.business.delete({ where: { id: business.id } }); await prisma.identity.deleteMany({ where: { id: { in: people.map(person => person.id) } } });
  }
});

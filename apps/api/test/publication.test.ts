import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { ZodError } from 'zod';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { tokenDigest, newOpaqueToken } from '../src/security/sessions.js';
import { localDateTimeToInstant } from '../src/scheduling/local-time.js';
import { acquireIntervalLocks } from '../src/scheduling/redis-slot-lock.js';
after(async () => { await Promise.allSettled([prisma.$disconnect(), redis.quit()]); });
test('publication readiness and public/owned paths preserve lifecycle across settings and races', async t => {
  const run = randomUUID(), people: string[] = [], businesses: string[] = [];
  let pause: (() => Promise<void>) | undefined;
  const app = Fastify(); app.setErrorHandler((error, _req, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INTERNAL', ...(error instanceof AppError ? { fields: error.fields } : {}) } }));
  await registerProviderRoutes(app); await registerBookingRoutes(app, { acquireLocks: async (...args) => { await pause?.(); return acquireIntervalLocks(...args); } }); await registerScreenFlows(app);
  async function person() { const p = await prisma.identity.create({ data: { email: `publish-${randomUUID()}@example.test` } }); people.push(p.id); const token = newOpaqueToken(); await prisma.session.create({ data: { identityId: p.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } }); return { id: p.id, headers: { authorization: `Bearer ${token}`, 'x-visit-client': 'native' } }; }
  const owner = await person(), foreign = await person();
  const business = await prisma.business.create({ data: { name: 'Pilot studio', slug: `publish-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED' } }); businesses.push(business.id);
  await prisma.membership.create({ data: { identityId: owner.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } });
  const base = `/v1/provider/businesses/${business.id}`, publish = (published: boolean) => app.inject({ method: 'PUT', url: `${base}/publication`, headers: owner.headers, payload: { published } });
  const date = Temporal.Now.zonedDateTimeISO('Asia/Jerusalem').toPlainDate().add({ days: 2 }).toString();
  const at = (time: string) => localDateTimeToInstant(date, time, 'Asia/Jerusalem').toISOString();
  let serviceId = '', staffId = '', confirmedId = '', heldId = '';
  const hold = (time: string) => app.inject({ method: 'POST', url: '/api/bookings/lock-slot', headers: owner.headers, payload: { finalConsent: true, providerId: business.id, serviceId, staffId, startsAt: at(time), idempotencyKey: randomUUID() } });
  try {
    await t.test('incomplete/foreign attempts fail with field blockers and no silent publishing', async () => {
      assert.equal((await app.inject({ url: `${base}/publication`, headers: foreign.headers })).statusCode, 403);
      const blocked = await publish(true); assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.fields.profile, 'COMPLETE_BUSINESS_PROFILE');
      assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).publishedAt, null);
      assert.equal((await app.inject({ url: `/api/providers/${business.id}` })).statusCode, 404);
      assert.equal((await app.inject({ url: '/api/providers' })).statusCode, 404); assert.equal((await app.inject({ url: '/v1/businesses' })).statusCode, 404);
    });
    await t.test('complete profile/catalog/staff/hours/policy then explicitly publish', async () => {
      assert.equal((await app.inject({ method: 'PATCH', url: base, headers: owner.headers, payload: { location: 'Jerusalem', category: 'Wellness' } })).statusCode, 200);
      const service = await app.inject({ method: 'POST', url: `${base}/services`, headers: owner.headers, payload: { name: 'Consultation', durationMinutes: 30 } }); assert.equal(service.statusCode, 201); serviceId = service.json().id;
      const staff = await app.inject({ method: 'POST', url: `${base}/staff`, headers: owner.headers, payload: { displayName: 'Expert', serviceIds: [serviceId] } }); assert.equal(staff.statusCode, 201); staffId = staff.json().id;
      assert.equal((await app.inject({ method: 'PUT', url: `${base}/availability-rules`, headers: owner.headers, payload: { weekly: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ startLocal: '09:00', endLocal: '17:00' }] })), overrides: [] } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'PUT', url: `${base}/booking-policy`, headers: owner.headers, payload: { minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } })).statusCode, 200);
      assert.equal((await app.inject({ url: `${base}/publication`, headers: owner.headers })).json().ready, true);
      assert.equal((await app.inject({ url: `/api/providers/${business.id}` })).statusCode, 404);
      assert.equal((await publish(true)).statusCode, 200);
      assert.equal((await app.inject({ url: `/api/providers/${business.id}` })).statusCode, 200);
      assert.equal((await app.inject({ url: `/v1/businesses/${business.id}/services` })).statusCode, 200);
      const a = await hold('09:00'), b = await hold('10:00'); assert.equal(a.statusCode, 201, a.body); assert.equal(b.statusCode, 201, b.body); confirmedId = a.json().holdId; heldId = b.json().holdId;
      assert.equal((await app.inject({ method: 'POST', url: `/api/bookings/confirm`, headers: owner.headers, payload: { holdId: confirmedId } })).statusCode, 200);
    });
    await t.test('unpublish expires temporary holds permanently but preserves owned appointments and rescheduling', async () => {
      const before = await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } });
      assert.equal((await publish(false)).statusCode, 200);
      assert.deepEqual(await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } }), before);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: heldId } })).status, 'EXPIRED'); assert.equal(await redis.get(`visit:hold:${heldId}`), null);
      assert.equal((await hold('12:00')).statusCode, 404);
      assert.equal((await app.inject({ url: `/v1/businesses/${business.id}/availability?serviceId=${serviceId}&date=${date}` })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${heldId}/confirm`, headers: owner.headers })).statusCode, 409);
      assert.equal((await app.inject({ url: `/api/bookings/${confirmedId}/provider`, headers: foreign.headers })).statusCode, 404);
      assert.equal((await app.inject({ url: `/api/bookings/${confirmedId}/provider`, headers: owner.headers })).statusCode, 200);
      assert.equal((await app.inject({ url: `/api/bookings/${confirmedId}/availability?date=${date}`, headers: owner.headers })).statusCode, 200);
      const moved = await app.inject({ method: 'POST', url: `/v1/bookings/${confirmedId}/reschedule`, headers: owner.headers, payload: { finalConsent: true, expectedRevision: before.revision, idempotencyKey: randomUUID(), staffId, startsAt: at('11:00') } }); assert.equal(moved.statusCode, 200, moved.body);
      assert.ok((await app.inject({ url: '/v1/me/bookings', headers: owner.headers })).json().bookings.some((b: { id: string }) => b.id === confirmedId));
      assert.equal((await publish(true)).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${heldId}/confirm`, headers: owner.headers })).statusCode, 409);
    });
    await t.test('confirmation racing unpublish either commits first or the hold expires', async () => {
      const reservation = await hold('15:00'); assert.equal(reservation.statusCode, 201, reservation.body);
      const id = reservation.json().holdId;
      const results = await Promise.all([app.inject({ method: 'POST', url: `/v1/bookings/${id}/confirm`, headers: owner.headers }), publish(false)]);
      assert.equal(results[1].statusCode, 200); assert.ok([200, 409].includes(results[0].statusCode));
      const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, results[0].statusCode === 200 ? 'CONFIRMED' : 'EXPIRED');
      assert.equal(row.holdExpiresAt, null);
      assert.equal((await publish(true)).statusCode, 200);
    });
    await t.test('valid edits retain publishing, invalid catalog changes suspend it without changing confirmed records', async () => {
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/services/${serviceId}`, headers: owner.headers, payload: { name: 'Updated consultation' } })).statusCode, 200);
      assert.ok((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).publishedAt);
      const before = await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } });
      const results = await Promise.all([publish(true), app.inject({ method: 'PATCH', url: `${base}/services/${serviceId}`, headers: owner.headers, payload: { active: false } })]);
      assert.ok([200, 409].includes(results[0].statusCode)); assert.equal(results[1].statusCode, 200);
      assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).publishedAt, null);
      assert.deepEqual(await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } }), before);
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/services/${serviceId}`, headers: owner.headers, payload: { active: true } })).statusCode, 200);
      assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).publishedAt, null);
    });
    await t.test('owned rescheduling keeps reserved service snapshots even after archival', async () => {
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/services/${serviceId}`, headers: owner.headers, payload: { durationMinutes: 60, name: 'Future catalog', active: false } })).statusCode, 200);
      const detail = (await app.inject({ url: `/api/bookings/${confirmedId}/provider`, headers: owner.headers })).json();
      assert.equal(detail.provider.services[0].durationMinutes, 30); assert.equal(detail.provider.services[0].name, 'Consultation');
      const availability = await app.inject({ url: `/api/bookings/${confirmedId}/availability?date=${date}`, headers: owner.headers });
      assert.equal(availability.statusCode, 200, availability.body); assert.equal(availability.json().service.durationMinutes, 30);
      assert.ok(availability.json().slots.some((slot: { startsAt: string; available: boolean }) => slot.startsAt === at('11:00') && slot.available));
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/services/${serviceId}`, headers: owner.headers, payload: { durationMinutes: 30, active: true } })).statusCode, 200);
    });
    await t.test('buffers block readiness and conflicting staff hours are rejected', async () => {
      const policy = { minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 300, bufferAfterMinutes: 300, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 };
      assert.equal((await app.inject({ method: 'PUT', url: `${base}/booking-policy`, headers: owner.headers, payload: policy })).statusCode, 200);
      const blocked = await publish(true); assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.fields[`services.${serviceId}.hours`], 'SERVICE_AND_BUFFERS_MUST_FIT_HOURS');
      assert.equal((await app.inject({ method: 'PUT', url: `${base}/booking-policy`, headers: owner.headers, payload: { ...policy, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'PUT', url: `${base}/staff/${staffId}/availability-rules`, headers: owner.headers, payload: { weekly: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ startLocal: '18:00', endLocal: '19:00' }] })), overrides: [] } })).statusCode, 409);
      assert.equal((await publish(true)).statusCode, 200);
      assert.equal((await app.inject({ method: 'PUT', url: `${base}/staff/${staffId}/availability-rules`, headers: owner.headers, payload: { weekly: [], overrides: [] } })).statusCode, 200);
    });
    await t.test('unpublish between hold preflight and transaction wins; direct database new holds fail closed', async () => {
      assert.equal((await publish(true)).statusCode, 200);
      let reached!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { reached = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      pause = async () => { reached(); await wait; };
      const pending = hold('13:00'); const started = pending.then(value => value); await ready;
      try { assert.equal((await publish(false)).statusCode, 200); } finally { release(); }
      assert.equal((await started).statusCode, 409); pause = undefined;
      await assert.rejects(prisma.booking.update({ where: { id: heldId }, data: { status: 'CONFIRMED' } }), /VISIT_BOOKING_INVALID_TRANSITION/);
      const existing = await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } });
      await assert.rejects(prisma.booking.create({ data: { businessId: business.id, customerId: owner.id, serviceId, staffId, startsAt: new Date(at('14:00')), endsAt: new Date(at('14:30')), occupiedFrom: new Date(at('14:00')), occupiedUntil: new Date(at('14:30')), status: 'HELD', holdExpiresAt: new Date(Date.now() + 60000), idempotencyKey: randomUUID() } }), /VISIT_BUSINESS_UNPUBLISHED/);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${confirmedId}/cancel`, headers: owner.headers })).statusCode, 200);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } })).startsAt.toISOString(), existing.startsAt.toISOString());
    });
    await t.test('non-Israel legacy data requires explicit migration review, never a zone relabel', async () => {
      await prisma.business.update({ where: { id: business.id }, data: { timezone: 'UTC' } });
      const blocked = await publish(true); assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.fields.timezone, 'ISRAEL_TIME_REVIEW_REQUIRED');
      assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).timezone, 'UTC');
    });
  } finally {
    pause = undefined; await app.close();
    const bookings = await prisma.booking.findMany({ where: { businessId: { in: businesses } }, select: { id: true } }); if (bookings.length) await redis.del(...bookings.map(b => `visit:hold:${b.id}`));
    for (const id of businesses) { const keys: string[] = []; for await (const batch of redis.scanStream({ match: `visit:reservation:${id}:*` })) keys.push(...batch); if (keys.length) await redis.del(...keys); }
    await prisma.booking.deleteMany({ where: { businessId: { in: businesses } } }); await prisma.business.deleteMany({ where: { id: { in: businesses } } }); await prisma.identity.deleteMany({ where: { id: { in: people } } });
  }
});

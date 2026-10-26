import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { env } from '../src/env.js';
import { AppError } from '../src/http/errors.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { tokenDigest } from '../src/security/sessions.js';
import { acquireIntervalLocks } from '../src/scheduling/redis-slot-lock.js';
import { localDateTimeToInstant } from '../src/scheduling/local-time.js';
import { requireHold } from '../src/scheduling/reservations.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });
test('approved business configures, publishes and shares through scoped setup APIs with safe staff edits', async t => {
  const run = randomUUID(), people: string[] = [], businesses: string[] = [];
  const app = Fastify(); let pause: (() => Promise<void>) | undefined;
  app.setErrorHandler((error, _r, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INVALID', detail: error.message } }));
  await registerProviderRoutes(app, { reviewScope: `test:setup:${run}` }); await registerScreenFlows(app);
  await registerBookingRoutes(app, { acquireLocks: async (...args) => { await pause?.(); return acquireIntervalLocks(...args); } });
  async function person(admin = false) { const p = await prisma.identity.create({ data: { email: `setup-${randomUUID()}@example.test`, emailVerifiedAt: new Date(), platformRole: admin ? 'ADMIN' : 'USER' } }); people.push(p.id); const token = randomUUID(); await prisma.session.create({ data: { identityId: p.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } }); return { id: p.id, headers: { authorization: `Bearer ${token}`, 'x-visit-client': 'native' } }; }
  const owner = await person(), outsider = await person(), admin = await person(true);
  const application = await app.inject({ method: 'POST', url: '/v1/provider-applications', headers: owner.headers, payload: { businessName: 'Setup pilot', slug: `setup-${run}` } }); assert.equal(application.statusCode, 201, application.body);
  const ownApplications = await app.inject({ url: '/v1/provider-applications', headers: owner.headers });
  const businessId: string = ownApplications.json().applications.find((row: { id: string }) => row.id === application.json().id).business.id; businesses.push(businessId);
  const base = `/v1/provider/businesses/${businessId}`;
  const request = (method: 'POST' | 'PATCH' | 'PUT', path: string, payload: object, headers = owner.headers) => app.inject({ method, url: base + path, headers, payload });
  const date = Temporal.Now.zonedDateTimeISO('Asia/Jerusalem').toPlainDate().add({ days: 3 }).toString(), at = (time: string) => localDateTimeToInstant(date, time, 'Asia/Jerusalem').toISOString();
  let serviceId = '', staffId = '', backupId = '';
  const hold = (time: string, resource = staffId) => app.inject({ method: 'POST', url: '/v1/bookings', headers: owner.headers, payload: { finalConsent: true, businessId, serviceId, staffId: resource, startsAt: at(time), idempotencyKey: randomUUID() } });
  try {
    await t.test('pending application cannot configure; reasoned admin approval enables unpublished setup', async () => {
      assert.equal((await app.inject({ url: base, headers: owner.headers })).statusCode, 403);
      const reviewed = await app.inject({ method: 'POST', url: `/v1/admin/provider-applications/${application.json().id}/decision`, headers: admin.headers, payload: { decision: 'APPROVED', reason: 'Synthetic approved application for setup lifecycle.' } }); assert.equal(reviewed.statusCode, 200, reviewed.body);
      assert.equal((await app.inject({ url: base, headers: owner.headers })).json().business.publishedAt, null);
      assert.deepEqual((await app.inject({ url: base + '/sharing', headers: owner.headers })).json(), { available: false, url: null });
    });
    await t.test('profile is strict, explicit public contact does not change identity or sharing slug/timezone', async () => {
      for (const payload of [{ slug: 'changed' }, { timezone: 'UTC' }, { approvalStatus: 'APPROVED' }, { contactEmail: 'bad' }, { contactPhone: '0501234567' }, { name: { set: 'spoof' } }]) assert.equal((await request('PATCH', '', payload)).statusCode, 400);
      assert.equal((await request('PATCH', '', { name: 'Attack studio' }, outsider.headers)).statusCode, 403);
      const updated = await request('PATCH', '', { location: 'Jerusalem', category: 'Wellness', description: 'Public studio details', contactEmail: 'studio@example.test', contactPhone: '+972501234567' }); assert.equal(updated.statusCode, 200, updated.body);
      const saved = (await app.inject({ url: base, headers: owner.headers })).json().business; assert.equal(saved.description, 'Public studio details'); assert.equal(saved.timezone, 'Asia/Jerusalem'); assert.equal(saved.slug, `setup-${run}`);
      assert.notEqual((await prisma.identity.findUniqueOrThrow({ where: { id: owner.id } })).email, saved.contactEmail);
      assert.equal((await app.inject({ url: `/api/providers/${businessId}` })).statusCode, 404);
    });
    await t.test('keyed staff creation is atomic/idempotent, scope-safe and defaults to capacity one', async () => {
      const service = await request('POST', '/services', { name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' }); assert.equal(service.statusCode, 201); serviceId = service.json().id;
      const input = { displayName: 'Pilot expert', serviceIds: [serviceId], parallelCapacity: 2, creationKey: randomUUID() };
      const created = await Promise.all([request('POST', '/staff', input), request('POST', '/staff', input)]); assert.deepEqual(created.map(r => r.statusCode), [201, 201]); staffId = created[0].json().id; assert.equal(created[1].json().id, staffId);
      assert.equal('creationKey' in created[0].json(), false); assert.equal('creationFingerprint' in created[0].json(), false);
      assert.equal((await request('POST', '/staff', { ...input, displayName: 'Changed request' })).statusCode, 409);
      const backup = await request('POST', '/staff', { displayName: 'Backup expert', serviceIds: [serviceId] }); assert.equal(backup.statusCode, 201); backupId = backup.json().id; assert.equal(backup.json().parallelCapacity, 1);
      for (const payload of [{ parallelCapacity: 0 }, { parallelCapacity: 101 }, { parallelCapacity: { increment: 1 } }, { businessId: 'foreign' }, { serviceIds: ['foreign'] }]) assert.equal((await request('PATCH', `/staff/${staffId}`, payload)).statusCode, 400);
      assert.equal((await request('PATCH', `/staff/${staffId}`, { active: false }, outsider.headers)).statusCode, 403);
      assert.equal((await request('PATCH', '/staff/foreign', { active: false })).statusCode, 404);
    });
    await t.test('saved business/staff schedules and policy produce real availability and canonical sharing after publish', async () => {
      const weekly = Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ startLocal: '09:00', endLocal: '17:00' }] }));
      assert.equal((await request('PUT', '/availability-rules', { weekly, overrides: [] })).statusCode, 200);
      assert.equal((await request('PUT', `/staff/${staffId}/availability-rules`, { weekly: [], overrides: [] })).statusCode, 200);
      assert.equal((await app.inject({ url: base + `/staff/${staffId}/availability-rules`, headers: outsider.headers })).statusCode, 403);
      assert.equal((await request('PUT', '/booking-policy', { minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 1440, rescheduleCutoffMinutes: 1440 })).statusCode, 200);
      assert.equal((await request('PUT', '/publication', { published: true })).statusCode, 200);
      const sharing = await app.inject({ url: base + '/sharing', headers: owner.headers }); assert.equal(sharing.json().url, new URL(`/p/setup-${run}`, env.WEB_APP_URL).href);
      assert.equal((await app.inject({ url: base + '/sharing', headers: outsider.headers })).statusCode, 403);
      const detail = (await app.inject({ url: `/api/providers/${businessId}` })).json().provider; assert.equal(detail.contactPhone, '+972501234567'); assert.equal(detail.description, 'Public studio details');
      const availability = await app.inject({ url: `/api/providers/${businessId}/availability?serviceId=${serviceId}&date=${date}` }); assert.equal(availability.statusCode, 200); assert.ok(availability.json().slots.some((s: { available: boolean }) => s.available));
    });
    await t.test('capacity cannot shrink below booked overlap; deactivation expires only target holds and preserves confirmations', async () => {
      const first = await hold('11:00'), second = await hold('11:00'); assert.equal(first.statusCode, 201, first.body); assert.equal(second.statusCode, 201, second.body);
      for (const row of [first, second]) assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${row.json().id}/confirm`, headers: owner.headers, payload: {} })).statusCode, 200);
      assert.equal((await request('PATCH', `/staff/${staffId}`, { parallelCapacity: 1 })).statusCode, 409);
      const held = await app.inject({ method: 'POST', url: '/api/bookings/lock-slot', headers: owner.headers, payload: { finalConsent: true, providerId: businessId, serviceId, staffId, startsAt: at('14:00'), idempotencyKey: randomUUID() } }), backup = await hold('14:00', backupId); assert.equal(held.statusCode, 201, held.body); assert.equal(backup.statusCode, 201);
      await requireHold(held.json().holdId, owner.id);
      const before = await prisma.booking.findUniqueOrThrow({ where: { id: first.json().id } });
      assert.equal((await request('PATCH', `/staff/${staffId}`, { displayName: 'Renamed expert', active: false })).statusCode, 200);
      assert.deepEqual(await prisma.booking.findUnique({ where: { id: first.json().id } }), before);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: held.json().holdId } })).status, 'EXPIRED');
      await assert.rejects(requireHold(held.json().holdId, owner.id));
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: backup.json().id } })).status, 'HELD');
      assert.ok((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).publishedAt); // Backup resource keeps readiness valid.
    });
    await t.test('assignment/deactivation between advisory read and reservation is rejected inside booking transaction', async () => {
      assert.equal((await request('PATCH', `/staff/${staffId}`, { active: true })).statusCode, 200);
      pause = async () => { pause = undefined; assert.equal((await request('PATCH', `/staff/${staffId}`, { serviceIds: [] })).statusCode, 200); };
      const stale = await hold('15:00'); assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(await prisma.booking.count({ where: { businessId, staffId, startsAt: new Date(at('15:00')) } }), 0);
      assert.equal((await request('PUT', '/publication', { published: false })).statusCode, 200);
      assert.deepEqual((await app.inject({ url: base + '/sharing', headers: owner.headers })).json(), { available: false, url: null });
    });
  } finally { await app.close(); await prisma.booking.deleteMany({ where: { businessId: { in: businesses } } }); await prisma.business.deleteMany({ where: { id: { in: businesses } } }); await prisma.identity.deleteMany({ where: { id: { in: people } } }); }
});

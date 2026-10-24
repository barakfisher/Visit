import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { parseServicePrice, validateService } from '@visit/contracts';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { tokenDigest } from '../src/security/sessions.js';

const valid = { name: 'Consultation', durationMinutes: 30, priceMinor: 1999, currency: 'ILS' };
test('service contract parses exact decimal minor units and rejects invalid payloads', () => {
  for (const [text, expected] of [['', null], ['0', 0], ['0.01', 1], ['19.99', 1999], ['20000000', 2000000000], ['001.5', 150]] as const) assert.equal(parseServicePrice(text), expected);
  for (const text of ['1.999', '-1', 'Infinity', 'NaN', '1e2', '20,00', '20000000.01']) assert.equal(parseServicePrice(text), undefined);
  for (const input of [{}, { ...valid, name: ' ' }, { ...valid, durationMinutes: 0 }, { ...valid, durationMinutes: 5.1 }, { ...valid, priceMinor: -1 }, { ...valid, priceMinor: 1.2 }, { ...valid, priceMinor: 2147483648 }, { ...valid, currency: 'JPY' }, { ...valid, currency: null }, { ...valid, priceMinor: null }, { ...valid, name: { set: 'Injected' } }, { ...valid, businessId: 'foreign' }]) assert.ok(Object.keys(validateService(input)).length);
  assert.deepEqual(validateService({ ...valid, priceMinor: 0 }), {});
  assert.deepEqual(validateService({ name: 'Free consultation', durationMinutes: 5 }), {});
});

test('service CRUD and booking snapshots stay scoped and preserve history on both HTTP surfaces', async t => {
  const run = randomUUID(), token = randomUUID();
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'VALIDATION_ERROR', ...(error instanceof AppError ? { fields: error.fields } : {}) } }));
  await registerProviderRoutes(app); await registerScreenFlows(app);
  let changeBeforeBooking: (() => Promise<void>) | undefined;
  await registerBookingRoutes(app, { acquireLocks: async () => { await changeBeforeBooking?.(); return { acquired: true, release: async () => {} }; } });
  const owner = await prisma.identity.create({ data: { email: `services-${run}@example.test` } });
  const business = await prisma.business.create({ data: { name: 'Catalog test', slug: `services-${run}`, timezone: 'UTC', approvalStatus: 'APPROVED' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Expert' } });
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
  const base = `/v1/provider/businesses/${business.id}/services`;
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  try {
    await prisma.membership.create({ data: { identityId: owner.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.session.create({ data: { identityId: owner.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
    await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
    await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
    await t.test('create validation is identical for v1 and staff-assignment compatibility API', async () => {
      for (const input of [{ ...valid, name: ' ' }, { ...valid, durationMinutes: -5 }, { ...valid, currency: null }, { ...valid, priceMinor: 2147483648 }, { ...valid, currency: 'XXX' }, { ...valid, description: 'x'.repeat(2001) }, { ...valid, businessId: 'foreign' }]) {
        for (const compatibility of [false, true]) {
          const response = await app.inject({ method: 'POST', url: compatibility ? `/api/provider/services?businessId=${business.id}` : base, headers, payload: { ...input, ...(compatibility ? { staffIds: [staff.id] } : {}) } });
          assert.equal(response.statusCode, 400, response.body);
        }
      }
      assert.equal(await prisma.service.count({ where: { businessId: business.id } }), 0);
    });
    const created = await app.inject({ method: 'POST', url: `/api/provider/services?businessId=${business.id}`, headers, payload: { ...valid, staffIds: [staff.id] } });
    assert.equal(created.statusCode, 201, created.body);
    const service = created.json();
    await t.test('partial editing validates resulting price pair and cannot accept Prisma operation objects', async () => {
      for (const payload of [{ priceMinor: null }, { currency: null }, { name: { set: 'Injection' } }, {}, { active: 'false' }]) assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${service.id}`, headers, payload })).statusCode, 400);
      const clear = await app.inject({ method: 'PATCH', url: `${base}/${service.id}`, headers, payload: { priceMinor: null, currency: null, description: '  Useful details  ' } });
      assert.equal(clear.statusCode, 200); assert.equal(clear.json().description, 'Useful details');
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${service.id}`, headers, payload: { priceMinor: 1999, currency: 'ILS' } })).statusCode, 200);
    });
    const held = await app.inject({ method: 'POST', url: '/v1/bookings', headers, payload: { businessId: business.id, serviceId: service.id, staffId: staff.id, startsAt: `${date}T09:00:00Z`, idempotencyKey: randomUUID() } });
    assert.equal(held.statusCode, 201, held.body);
    const bookingId = held.json().id;
    await t.test('held snapshots survive catalog name, duration, price and currency edits through confirmation', async () => {
      const update = await app.inject({ method: 'PATCH', url: `${base}/${service.id}`, headers, payload: { name: 'Renamed service', durationMinutes: 60, priceMinor: 5000, currency: 'USD' } });
      assert.equal(update.statusCode, 200, update.body);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${bookingId}/confirm`, headers, payload: {} })).statusCode, 200);
      const consumer = await app.inject({ url: '/v1/me/bookings', headers });
      assert.deepEqual(consumer.json().bookings[0].service, { id: service.id, ...valid });
      const provider = await app.inject({ url: `/api/provider/agenda?businessId=${business.id}&date=${date}`, headers });
      assert.deepEqual(provider.json().summary.revenue, { ILS: 1999 });
      assert.equal(provider.json().bookings[0].service.name, valid.name);
      const list = await app.inject({ url: `/v1/provider/businesses/${business.id}/bookings`, headers });
      assert.equal(list.json().bookings[0].service.durationMinutes, 30);
      await assert.rejects(prisma.booking.update({ where: { id: bookingId }, data: { serviceName: 'Tampered' } }));
      const spoofed = await prisma.booking.create({ data: { businessId: business.id, customerId: owner.id, staffId: staff.id, serviceId: service.id, startsAt: new Date(`${date}T15:00:00Z`), endsAt: new Date(`${date}T16:00:00Z`), occupiedFrom: new Date(`${date}T15:00:00Z`), occupiedUntil: new Date(`${date}T16:00:00Z`), status: 'EXPIRED', idempotencyKey: randomUUID(), serviceName: 'Forged snapshot', serviceDurationMinutes: 1, servicePriceMinor: -10, serviceCurrency: 'XXX' } });
      assert.equal(spoofed.serviceName, 'Renamed service'); assert.equal(spoofed.servicePriceMinor, 5000); assert.equal(spoofed.serviceDurationMinutes, 60); assert.equal(spoofed.serviceCurrency, 'USD');
      await prisma.booking.delete({ where: { id: spoofed.id } });
    });
    await t.test('existing appointments reschedule using reserved duration after catalog duration changes', async () => {
      const response = await app.inject({ method: 'POST', url: `/v1/bookings/${bookingId}/reschedule`, headers, payload: { staffId: staff.id, startsAt: `${date}T11:00:00Z` } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().endsAt, `${date}T11:30:00.000Z`);
    });
    await t.test('an edit between availability selection and hold insertion rejects the stale selection', async () => {
      changeBeforeBooking = async () => {
        const before = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
        // Even writes sharing a millisecond timestamp must invalidate a stale selection.
        await prisma.service.update({ where: { id: service.id }, data: { durationMinutes: 45, updatedAt: before.updatedAt } });
      };
      const response = await app.inject({ method: 'POST', url: '/v1/bookings', headers, payload: { businessId: business.id, serviceId: service.id, staffId: staff.id, startsAt: `${date}T13:00:00Z`, idempotencyKey: randomUUID() } });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 1);
      changeBeforeBooking = undefined;
    });
    await t.test('cancelled historical service deletion archives, hides from discovery, and can be restored', async () => {
      await prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
      const response = await app.inject({ method: 'DELETE', url: `${base}/${service.id}`, headers });
      assert.equal(response.statusCode, 200); assert.equal(response.json().archived, true);
      assert.equal((await app.inject({ url: `/v1/businesses/${business.id}/services` })).json().services.length, 0);
      assert.equal((await app.inject({ url: '/v1/me/bookings', headers })).json().bookings[0].service.name, valid.name);
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${service.id}`, headers, payload: { active: true } })).statusCode, 200);
      assert.equal((await app.inject({ url: `/v1/businesses/${business.id}/services` })).json().services.length, 1);
    });
    await t.test('unreferenced services are deleted and database writes cannot bypass price validation', async () => {
      const added = await app.inject({ method: 'POST', url: base, headers, payload: { name: 'Unused service', durationMinutes: 5 } });
      assert.equal(added.statusCode, 201);
      const deleted = await app.inject({ method: 'DELETE', url: `${base}/${added.json().id}`, headers });
      assert.equal(deleted.json().deleted, true);
      assert.equal((await app.inject({ url: `${base}/${added.json().id}`, headers })).statusCode, 404);
      await assert.rejects(prisma.service.update({ where: { id: service.id }, data: { priceMinor: -1 } }));
      await assert.rejects(prisma.service.update({ where: { id: service.id }, data: { currency: null } }));
    });
  } finally {
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } }); await prisma.identity.delete({ where: { id: owner.id } });
    await app.close(); await prisma.$disconnect(); redis.disconnect();
  }
});

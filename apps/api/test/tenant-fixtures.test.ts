import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { createTwoTenantFixture, resetTwoTenantFixture } from './support/two-tenant.js';

test('repeatable isolated fixtures cover both directions of foundation HTTP tenant boundaries', async t => {
  const app = await createApp();
  const run = randomUUID(), sentinelRun = randomUUID();
  let fixture: Awaited<ReturnType<typeof createTwoTenantFixture>> | undefined;
  try {
    fixture = await createTwoTenantFixture(run);
    const sentinel = await createTwoTenantFixture(sentinelRun, fixture.date);
    const originalIds = fixture.businesses.map(row => row.id);
    await t.test('exact reset is repeatable, safe against unrelated fixtures and rejects invalid namespaces', async () => {
      await assert.rejects(createTwoTenantFixture(run), /already exists/);
      await assert.rejects(resetTwoTenantFixture('*'), /UUID/);
      await fixture!.reset(); await fixture!.reset();
      assert.equal(await prisma.business.count({ where: { id: { in: originalIds } } }), 0);
      assert.equal(await prisma.business.count({ where: { id: { in: sentinel.businesses.map(row => row.id) } } }), 2);
      fixture = await createTwoTenantFixture(run, fixture!.date);
      assert.deepEqual(fixture.businesses.map(row => row.id), originalIds);
      assert.equal(await prisma.membership.count({ where: { identityId: fixture.people[2]!.id, status: 'ACTIVE' } }), 2);
      // Even an exact ID does not authorize deleting a row whose ownership marker changed.
      const identity = fixture.people[5]!;
      await prisma.identity.update({ where: { id: identity.id }, data: { email: `not-the-fixture-marker-${run}@example.test` } });
      try {
        await assert.rejects(fixture.reset(), /exact fixture marker/);
        assert.equal(await prisma.business.count({ where: { id: { in: originalIds } } }), 2, 'failed reset rolled back before deletion');
      } finally { await prisma.identity.update({ where: { id: identity.id }, data: { email: identity.email } }); }
    });
    const f = fixture;
    for (const [index, owner, otherOwner] of [[0, 'north', 'south'], [1, 'south', 'north']] as const) {
      const own = f.businesses[index]!, foreign = f.businesses[1 - index]!, service = f.services[index]!, foreignService = f.services[1 - index]!, resource = f.staff[index]!, foreignStaff = f.staff[1 - index]!, foreignBooking = f.bookings[1 - index]!, foreignBlock = f.blocks[1 - index]!;
      const base = `/v1/provider/businesses/${own.id}`;
      await t.test(`${owner}: foreign list/read/create/update/delete and booking ownership stay isolated`, async () => {
        const before = await prisma.business.findUniqueOrThrow({ where: { id: foreign.id }, include: { services: true, staff: true, bookings: true, timeBlocks: true, bookingPolicy: true, weeklyAvailability: true } });
        for (const suffix of ['', '/services', '/staff', '/booking-policy', '/availability-rules', '/bookings']) {
          const response = await app.inject({ url: base + suffix, headers: f.headers(otherOwner) });
          assert.equal(response.statusCode, 403, `foreign list ${suffix}`);
          assert.equal(JSON.stringify(response.json()).includes(service.id), false);
        }
        for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
          assert.equal((await app.inject({ method, url: `${base}/services/${foreignService.id}`, headers: f.headers(owner), ...(method === 'PATCH' ? { payload: { name: 'Foreign write attempt' } } : {}) })).statusCode, 404);
        }
        const createPaths = [`${base}/services`, `/api/provider/services?businessId=${own.id}`];
        for (const url of createPaths) {
          const response = await app.inject({ method: 'POST', url, headers: f.headers(otherOwner), payload: { name: 'Foreign create attempt', durationMinutes: 30 } });
          assert.equal(response.statusCode, 403);
        }
        assert.equal((await app.inject({ method: 'POST', url: `/api/provider/services?businessId=${own.id}`, headers: f.headers(owner), payload: { name: 'Foreign assignment', durationMinutes: 30, staffIds: [foreignStaff.id] } })).statusCode, 404);
        assert.equal((await app.inject({ method: 'POST', url: `${base}/staff`, headers: f.headers(owner), payload: { displayName: 'Foreign assignment', serviceIds: [foreignService.id] } })).statusCode, 400);
        const rules = { weekly: [], overrides: [] };
        assert.equal((await app.inject({ method: 'PUT', url: `${base}/staff/${foreignStaff.id}/availability-rules`, headers: f.headers(owner), payload: rules })).statusCode, 404);
        for (const method of ['GET', 'PUT'] as const) {
          assert.equal((await app.inject({ method, url: `/v1/provider/businesses/${foreign.id}/availability-rules`, headers: f.headers(owner), ...(method === 'PUT' ? { payload: rules } : {}) })).statusCode, 403);
        }
        assert.equal((await app.inject({ method: 'POST', url: '/api/provider/block-time', headers: f.headers(owner), payload: { businessId: own.id, staffId: foreignStaff.id, date: f.date, startLocal: '14:00', endLocal: '14:30' } })).statusCode, 404);
        assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${foreignBlock.id}?businessId=${own.id}`, headers: f.headers(owner) })).statusCode, 404);
        for (const action of ['confirm', 'cancel', 'reschedule']) assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${foreignBooking.id}/${action}`, headers: f.headers(owner), payload: action === 'reschedule' ? { staffId: resource.id, startsAt: `${f.date}T15:00:00Z` } : {} })).statusCode, 404);
        assert.equal((await app.inject({ method: 'POST', url: `${base}/bookings/${foreignBooking.id}/cancel`, headers: f.headers(owner), payload: {} })).statusCode, 404);
        assert.equal((await app.inject({ method: 'POST', url: '/api/bookings/confirm', headers: f.headers(owner), payload: { holdId: foreignBooking.id } })).statusCode, 404);
        // Release is deliberately non-enumerating/idempotent; it cannot cancel another identity's booking.
        assert.equal((await app.inject({ method: 'POST', url: `/api/bookings/${foreignBooking.id}/release`, headers: f.headers(owner), payload: {} })).statusCode, 200);
        for (const [serviceId, staffId] of [[foreignService.id, resource.id], [service.id, foreignStaff.id]]) {
          const payload = { businessId: own.id, serviceId, staffId, startsAt: `${f.date}T15:00:00Z`, idempotencyKey: randomUUID() };
          assert.equal((await app.inject({ method: 'POST', url: '/v1/bookings', headers: f.headers(owner), payload })).statusCode, 404);
          const { businessId, ...rest } = payload;
          assert.equal((await app.inject({ method: 'POST', url: '/api/bookings/lock-slot', headers: f.headers(owner), payload: { providerId: businessId, ...rest } })).statusCode, 404);
        }
        const after = await prisma.business.findUniqueOrThrow({ where: { id: foreign.id }, include: { services: true, staff: true, bookings: true, timeBlocks: true, bookingPolicy: true, weeklyAvailability: true } });
        assert.deepEqual(after, before, 'foreign rows remain byte-for-byte unchanged');
        assert.equal(await prisma.service.count({ where: { businessId: own.id, name: { startsWith: 'Foreign' } } }), 0);
      });
    }
    await t.test('global identity, membership roles and anonymous actors remain distinct', async () => {
      for (const business of f.businesses) {
        const response = await app.inject({ url: `/api/provider/services?businessId=${business.id}`, headers: f.headers('dual') });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json().services.map((row: { businessId: string }) => row.businessId), [business.id]);
      }
      assert.equal((await app.inject({ url: '/api/provider/services', headers: f.headers('dual') })).statusCode, 400, 'ambiguous context requires explicit workspace');
      const business = f.businesses[0]!;
      for (const actor of ['pending', 'outsider', 'staff'] as const) assert.equal((await app.inject({ method: 'POST', url: `/v1/provider/businesses/${business.id}/services`, headers: f.headers(actor), payload: { name: 'Unauthorized mutation', durationMinutes: 30 } })).statusCode, 403);
      for (const url of [`/v1/provider/businesses/${business.id}/services`, `/api/provider/agenda?businessId=${business.id}&date=${f.date}`, '/api/consumer/bookings/active']) assert.equal((await app.inject({ url })).statusCode, 401);
      const response = await app.inject({ url: `/v1/me?identityId=${f.people[1]!.id}`, headers: { ...f.headers('north'), 'x-business-id': f.businesses[1]!.id } });
      assert.equal(response.json().identity.id, f.people[0]!.id);
      assert.equal(response.json().memberships.length, 1);
    });
  } finally {
    await app.close();
    await resetTwoTenantFixture(run);
    await resetTwoTenantFixture(sentinelRun);
    redis.disconnect(); await prisma.$disconnect();
  }
});

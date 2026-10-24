import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { tokenDigest } from '../src/security/sessions.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { createIntervalLocker } from '../src/scheduling/redis-slot-lock.js';
import { isDatabaseCapacityError, retrySerializable, withBookingTransaction } from '../src/scheduling/booking-transaction.js';

test('serialization retries are bounded and do not retry domain conflicts', async () => {
  let attempts = 0;
  assert.equal(await retrySerializable(async () => { if (++attempts < 3) throw { code: 'P2034' }; return 42; }), 42);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retrySerializable(async () => { attempts++; throw { code: 'P2034' }; }), (error: unknown) => error instanceof AppError && error.statusCode === 409);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retrySerializable(async () => { attempts++; throw new AppError(400, 'VALIDATION_ERROR', 'invalid'); }), (error: unknown) => error instanceof AppError && error.statusCode === 400);
  assert.equal(attempts, 1);
  await assert.rejects(retrySerializable(async () => 1, 4), RangeError);
});

test('database capacity guard is authoritative without Redis, including direct writes and crashes', async t => {
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Guard fixture', slug: `guard-${suffix}`, timezone: 'UTC', approvalStatus: 'APPROVED' } });
  const identity = await prisma.identity.create({ data: { email: `guard-${suffix}@example.test` } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Guard service', durationMinutes: 30 } });
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const resource = async (capacity = 1) => {
    const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: randomUUID(), parallelCapacity: capacity } });
    await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
    return staff;
  };
  const input = (staffId: string, minute = 0, before = 0, after = 0) => {
    const startsAt = new Date(new Date(`${day}T09:00:00Z`).getTime() + minute * 60000);
    return { businessId: business.id, staffId, serviceId: service.id, customerId: identity.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60000), occupiedFrom: new Date(startsAt.getTime() - before * 60000), occupiedUntil: new Date(startsAt.getTime() + (30 + after) * 60000), status: 'CONFIRMED' as const, idempotencyKey: randomUUID() };
  };
  const assertPeak = async (staffId: string, maximum: number) => {
    const rows = await prisma.$queryRaw<{ peak: number }[]>`SELECT visit_resource_peak(${business.id}, ${staffId}) AS peak`;
    assert.ok(rows[0]!.peak <= maximum); return rows[0]!.peak;
  };
  try {
    await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
    await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
    await t.test('direct concurrent writes at READ COMMITTED cannot bypass capacity one', async () => {
      const staff = await resource();
      const results = await Promise.allSettled([0, 15].map(minute => prisma.booking.create({ data: input(staff.id, minute) })));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected' && isDatabaseCapacityError(rejected.reason));
      assert.equal(await assertPeak(staff.id, 1), 1);
    });
    await t.test('serializable retries permit capacity two and reject the third writer', async () => {
      const staff = await resource(2);
      const results = await Promise.allSettled([0, 5, 10].map(minute => withBookingTransaction(tx => tx.booking.create({ data: input(staff.id, minute) }))));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
      assert.equal(await assertPeak(staff.id, 2), 2);
      await assert.rejects(prisma.staff.update({ where: { id: staff.id }, data: { parallelCapacity: 1 } }), isDatabaseCapacityError);
      assert.equal((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).parallelCapacity, 2);
    });
    await t.test('buffer-only overlaps conflict while half-open adjacent occupancy succeeds', async () => {
      const staff = await resource();
      await prisma.booking.create({ data: input(staff.id, 0, 10, 10) });
      await assert.rejects(prisma.booking.create({ data: input(staff.id, 45, 10, 10) }), isDatabaseCapacityError);
      await prisma.booking.create({ data: input(staff.id, 50, 10, 0) });
      assert.equal(await assertPeak(staff.id, 1), 1);
    });
    await t.test('expired holds cannot resurrect into occupied capacity', async () => {
      const staff = await resource();
      const expired = await prisma.booking.create({ data: { ...input(staff.id), status: 'HELD', holdExpiresAt: new Date(Date.now() - 1000) } });
      await prisma.booking.create({ data: input(staff.id) });
      await assert.rejects(prisma.booking.update({ where: { id: expired.id }, data: { status: 'CONFIRMED', holdExpiresAt: null } }), isDatabaseCapacityError);
      assert.equal(await assertPeak(staff.id, 1), 1);
    });
    await t.test('transaction crash rolls back booking and releases database resource locks', async () => {
      const staff = await resource();
      await assert.rejects(withBookingTransaction(async tx => { await tx.booking.create({ data: input(staff.id) }); throw new Error('simulated worker crash'); }), /simulated worker crash/);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, staffId: staff.id } }), 0);
      await withBookingTransaction(tx => tx.booking.create({ data: input(staff.id) }));
      assert.equal(await assertPeak(staff.id, 1), 1);
    });
    await t.test('duplicate transactional submissions reuse a single idempotency record', async () => {
      const staff = await resource();
      const data = input(staff.id);
      const create = () => withBookingTransaction(async tx => {
        const existing = await tx.booking.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: data.idempotencyKey } } });
        return existing ?? tx.booking.create({ data });
      });
      const [first, second] = await Promise.all([create(), create()]);
      assert.equal(first.id, second.id);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, staffId: staff.id } }), 1);
    });
    await t.test('HTTP hold creation returns 503 and writes nothing when lock transport is unavailable', async () => {
      const staff = await resource();
      const token = randomUUID();
      await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 60000) } });
      const app = Fastify();
      const unavailable = createIntervalLocker({ ready: async () => { throw new Error('offline'); }, evaluate: async () => 0 });
      await registerBookingRoutes(app, { acquireLocks: unavailable });
      try {
        const result = await app.inject({ method: 'POST', url: '/v1/bookings', headers: { authorization: `Bearer ${token}` }, payload: { businessId: business.id, staffId: staff.id, serviceId: service.id, startsAt: `${day}T09:00:00Z`, idempotencyKey: randomUUID() } });
        assert.equal(result.statusCode, 503);
        assert.equal(await prisma.booking.count({ where: { businessId: business.id, staffId: staff.id } }), 0);
      } finally { await app.close(); }
    });
    await t.test('reschedule can reuse capacity from an expired hold without Redis coordination', async () => {
      const staff = await resource();
      const original = await prisma.booking.create({ data: input(staff.id) });
      await prisma.booking.create({ data: { ...input(staff.id, 60), status: 'HELD', holdExpiresAt: new Date(Date.now() - 1000) } });
      const token = randomUUID();
      await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 60000) } });
      const app = Fastify();
      // Internal test seam bypasses Redis; database/application guards still apply.
      await registerBookingRoutes(app, { acquireLocks: async () => ({ acquired: true, release: async () => true }) });
      try {
        const response = await app.inject({ method: 'POST', url: `/v1/bookings/${original.id}/reschedule`, headers: { authorization: `Bearer ${token}` }, payload: { staffId: staff.id, startsAt: `${day}T10:00:00Z` } });
        assert.equal(response.statusCode, 200);
        assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: original.id } })).startsAt.toISOString(), `${day}T10:00:00.000Z`);
      } finally { await app.close(); }
    });
  } finally {
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.delete({ where: { id: identity.id } });
    redis.disconnect(); await prisma.$disconnect();
  }
});

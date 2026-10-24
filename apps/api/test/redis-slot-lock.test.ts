import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { redis } from '../src/infra/redis.js';
import { acquireIntervalLocks, createIntervalLocker, intervalLockKeys } from '../src/scheduling/redis-slot-lock.js';
import { AppError } from '../src/http/errors.js';

after(async () => { await redis.quit().catch(() => undefined); });

test('expired interval locks cannot be released by their previous owner', async () => {
  const businessId = `test-${randomUUID()}`;
  const staffId = `test-${randomUUID()}`;
  const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 60_000) * 60_000);
  const interval = { startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000) };
  const firstOwner = await acquireIntervalLocks(businessId, staffId, interval);
  assert.equal(firstOwner.acquired, true);
  if (!firstOwner.acquired) return;

  const firstBucket = Math.floor(interval.startsAt.getTime() / 60_000);
  const lastBucket = Math.ceil(interval.endsAt.getTime() / 60_000);
  const keys = Array.from({ length: lastBucket - firstBucket }, (_, index) => `visit:slot:${businessId}:${staffId}:${firstBucket + index}`);
  try {
    const ttl = await redis.pttl(keys[0]!);
    assert.ok(ttl > 0 && ttl <= 30000);
    await Promise.all(keys.map(key => redis.pexpire(key, 0))); // Simulate worker death and Redis TTL expiry without sleeps.
    const secondOwner = await acquireIntervalLocks(businessId, staffId, interval);
    assert.equal(secondOwner.acquired, true);
    if (!secondOwner.acquired) return;

    await firstOwner.release();
    const competingOwner = await acquireIntervalLocks(businessId, staffId, interval);
    assert.equal(competingOwner.acquired, false, 'a stale release must not remove the replacement owner lock');

    await secondOwner.release();
    const afterRelease = await acquireIntervalLocks(businessId, staffId, interval);
    assert.equal(afterRelease.acquired, true);
    if (afterRelease.acquired) await afterRelease.release();
  } finally {
    await redis.del(...keys);
  }
});

test('interval keys cover full ranges in canonical order and isolate resources', () => {
  const range = { startsAt: new Date('2030-01-01T09:00:00Z'), endsAt: new Date('2030-01-01T09:30:00Z') };
  const keys = intervalLockKeys('a:b', 'c', range);
  assert.equal(keys.length, 30);
  assert.equal(keys.filter(key => intervalLockKeys('a:b', 'c', { startsAt: new Date('2030-01-01T09:15:00Z'), endsAt: new Date('2030-01-01T09:45:00Z') }).includes(key)).length, 15);
  assert.equal(keys.some(key => intervalLockKeys('a:b', 'c', { startsAt: range.endsAt, endsAt: new Date('2030-01-01T10:00:00Z') }).includes(key)), false);
  assert.notDeepEqual(keys, intervalLockKeys('a', 'b:c', range));
  assert.throws(() => intervalLockKeys('a', 'b', { startsAt: range.endsAt, endsAt: range.startsAt }), RangeError);
  assert.throws(() => intervalLockKeys('a', 'b', { startsAt: range.startsAt, endsAt: new Date('2031-01-01') }), RangeError);
});

test('Redis outage fails closed; contention retries and cleanup are bounded', async () => {
  const range = { startsAt: new Date('2030-01-01T09:00:00Z'), endsAt: new Date('2030-01-01T09:30:00Z') };
  const unavailable = createIntervalLocker({ ready: async () => { throw new Error('offline'); }, evaluate: async () => { throw new Error('unreachable'); } });
  await assert.rejects(unavailable('a', 'b', range), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === 'LOCK_UNAVAILABLE');
  let calls = 0;
  const contention = createIntervalLocker({ ready: async () => {}, evaluate: async () => ++calls === 2 ? 1 : 0 });
  assert.equal((await contention('a', 'b', range, { attempts: 3 })).acquired, true);
  assert.equal(calls, 2);
  const failingCleanup = createIntervalLocker({ ready: async () => {}, evaluate: async () => { if (calls++ === 2) return 1; throw new Error('disconnected after acquire'); } });
  const owned = await failingCleanup('a', 'b', range);
  assert.equal(owned.acquired, true); assert.equal(await owned.release(), false);
  await assert.rejects(unavailable('a', 'b', range, { attempts: 4 }), RangeError);
  await assert.rejects(unavailable('a', 'b', range, { ttlMs: 30001 }), RangeError);
});

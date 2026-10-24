import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { redis } from '../src/infra/redis.js';
import { acquireIntervalLocks } from '../src/scheduling/redis-slot-lock.js';

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
    await redis.del(...keys); // Simulate the original owner's TTL expiring without waiting.
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

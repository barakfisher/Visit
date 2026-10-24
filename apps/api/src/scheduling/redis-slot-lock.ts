import { randomUUID } from 'node:crypto';
import { redis } from '../infra/redis.js';
import { ensureRedisReady } from '../infra/redis.js';
import type { Interval } from './intervals.js';

const releaseOwnedLocks = `for i, key in ipairs(KEYS) do if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key) end end return 1`;
const acquireAllLocks = `for i, key in ipairs(KEYS) do if redis.call('EXISTS', key) == 1 then return 0 end end for i, key in ipairs(KEYS) do redis.call('SET', key, ARGV[1], 'EX', ARGV[2]) end return 1`;

export async function acquireIntervalLocks(businessId: string, staffId: string, interval: Interval) {
  const token = randomUUID();
  const firstBucket = Math.floor(interval.startsAt.getTime() / 60_000);
  const lastBucket = Math.ceil(interval.endsAt.getTime() / 60_000);
  const keys = Array.from({ length: Math.max(1, lastBucket - firstBucket) }, (_, index) => `visit:slot:${businessId}:${staffId}:${firstBucket + index}`);
  try {
    await ensureRedisReady();
    const result = await redis.eval(acquireAllLocks, keys.length, ...keys, token, '300');
    if (result !== 1) return { acquired: false as const, release: async () => {} };
    return { acquired: true as const, release: async () => { await redis.eval(releaseOwnedLocks, keys.length, ...keys, token); } };
  } catch {
    // Redis only coordinates; the PostgreSQL serializable transaction remains authoritative.
    return { acquired: true as const, release: async () => {} };
  }
}

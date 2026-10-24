import { randomUUID } from 'node:crypto';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { AppError } from '../http/errors.js';
import type { Interval } from './intervals.js';

const releaseOwned = `local released = 0 for _, key in ipairs(KEYS) do if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key) released = released + 1 end end return released`;
const acquireAll = `for _, key in ipairs(KEYS) do if redis.call('EXISTS', key) == 1 then return 0 end end for _, key in ipairs(KEYS) do redis.call('SET', key, ARGV[1], 'PX', ARGV[2]) end return 1`;
export type LockTransport = { ready: () => Promise<void>; evaluate: (script: string, count: number, ...arguments_: (string | number)[]) => Promise<unknown> };

export function intervalLockKeys(businessId: string, staffId: string, interval: Interval) {
  const from = interval.startsAt.getTime(), until = interval.endsAt.getTime();
  if (!businessId || !staffId || !Number.isFinite(from) || !Number.isFinite(until) || until <= from || from % 60000 || until % 60000 || until - from > 4320 * 60000) {
    throw new RangeError('Locks require a tenant, staff and positive whole-minute interval of at most 72 hours.');
  }
  return Array.from({ length: (until - from) / 60000 }, (_, index) => `visit:slot:${encodeURIComponent(businessId)}:${encodeURIComponent(staffId)}:${from / 60000 + index}`);
}

export function createIntervalLocker(transport: LockTransport) {
  return async (businessId: string, staffId: string, interval: Interval, { ttlMs = 30000, attempts = 1 }: { ttlMs?: number; attempts?: number } = {}) => {
    const keys = intervalLockKeys(businessId, staffId, interval);
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 30000 || !Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new RangeError('Locks require a bounded TTL and at most three attempts.');
    const token = randomUUID();
    try {
      await transport.ready();
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (await transport.evaluate(acquireAll, keys.length, ...keys, token, ttlMs) === 1) {
          return { acquired: true as const, release: async () => {
            try { return Number(await transport.evaluate(releaseOwned, keys.length, ...keys, token)) > 0; }
            catch { return false; } // DB commit survives cleanup failure; TTL recovers.
          } };
        }
      }
      return { acquired: false as const, release: async () => false };
    } catch { throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable. Please retry shortly.'); }
  };
}

export const acquireIntervalLocks = createIntervalLocker({ ready: ensureRedisReady, evaluate: (script, count, ...args) => redis.eval(script, count, ...args) });

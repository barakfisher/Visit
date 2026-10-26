import { redis, ensureRedisReady } from '../infra/redis.js';
import { AppError } from '../http/errors.js';
import { z } from 'zod';
const reservationSchema = z.object({ customerId: z.string(), keys: z.array(z.string()).min(1) });
// The ownership record and all minute buckets are acquired in one Redis operation.
const acquire = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if tonumber(ARGV[1]) <= now then return -1 end
local previous = redis.call('GET', KEYS[1])
if previous and previous ~= ARGV[4] then return -1 end
for i = 2, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  if not redis.call('ZSCORE', KEYS[i], ARGV[2]) and redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[3]) then return 0 end
end
for i = 2, #KEYS do
  redis.call('ZADD', KEYS[i], ARGV[1], ARGV[2])
  redis.call('PEXPIREAT', KEYS[i], math.max(tonumber(ARGV[1]), now + math.max(0, redis.call('PTTL', KEYS[i]))))
end
redis.call('SET', KEYS[1], ARGV[4], 'PXAT', ARGV[1])
return 1`;

export async function reserveHold(booking: { id: string; businessId: string; staffId: string; customerId: string; occupiedFrom: Date; occupiedUntil: Date; holdExpiresAt: Date | null }, capacity: number) {
  if (!booking.holdExpiresAt || !Number.isFinite(booking.holdExpiresAt.getTime()) || booking.holdExpiresAt <= new Date()) throw new AppError(409, 'HOLD_EXPIRED', 'This attempt expired. Choose a time again.');
  const from = Math.floor(booking.occupiedFrom.getTime() / 60000), to = Math.ceil(booking.occupiedUntil.getTime() / 60000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isInteger(capacity) || capacity < 1 || to <= from || to - from > 4320) throw new AppError(409, 'INVALID_RESERVATION', 'Review the appointment interval.');
  const keys = Array.from({ length: to - from }, (_, i) => `visit:reservation:${booking.businessId}:${booking.staffId}:${from + i}`);
  try {
    await ensureRedisReady();
    const result = await redis.eval(acquire, keys.length + 1, `visit:hold:${booking.id}`, ...keys, booking.holdExpiresAt.getTime(), booking.id, capacity, JSON.stringify({ customerId: booking.customerId, keys }));
    if (result === -1) throw new AppError(409, 'HOLD_EXPIRED', 'This attempt expired. Choose a time again.');
    if (result !== 1) throw new AppError(409, 'SLOT_LOCKED', 'Someone else is booking this time. Choose another slot.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable. Please try again.');
  }
}

export async function requireHold(id: string, customerId: string) {
  try {
    await ensureRedisReady();
    const raw = await redis.get(`visit:hold:${id}`), parsed = raw ? reservationSchema.safeParse(JSON.parse(raw)) : null;
    if (!raw || !parsed?.success || parsed.data.customerId !== customerId) throw new AppError(409, 'HOLD_EXPIRED', 'Your attempt expired. Choose a time again.');
    const keys = parsed.data.keys;
    const valid = await redis.eval(`
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      local clock = redis.call('TIME')
      local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
      for i = 2, #KEYS do
        local expiry = redis.call('ZSCORE', KEYS[i], ARGV[2])
        if not expiry or tonumber(expiry) <= now then return 0 end
      end
      return 1`, keys.length + 1, `visit:hold:${id}`, ...keys, raw, id);
    if (valid !== 1) throw new AppError(409, 'HOLD_EXPIRED', 'Your attempt expired. Choose a time again.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable. Please try again.');
  }
}

export async function releaseHold(id: string, customerId: string) {
  await ensureRedisReady();
  const raw = await redis.get(`visit:hold:${id}`), parsed = raw ? reservationSchema.safeParse(JSON.parse(raw)) : null;
  if (!raw || !parsed?.success || parsed.data.customerId !== customerId) return;
  const keys = parsed.data.keys;
  await redis.eval(`if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end for i = 2, #KEYS do redis.call('ZREM', KEYS[i], ARGV[2]) end redis.call('DEL', KEYS[1]) return 1`, keys.length + 1, `visit:hold:${id}`, ...keys, raw, id);
}

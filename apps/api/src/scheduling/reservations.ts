import { redis, ensureRedisReady } from '../infra/redis.js';
import { AppError } from '../http/errors.js';

// Minute buckets match the scheduling engine's whole-minute, half-open intervals.
const acquire = `
for _, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', ARGV[1])
  if not redis.call('ZSCORE', key, ARGV[3]) and redis.call('ZCARD', key) >= tonumber(ARGV[4]) then return 0 end
end
for _, key in ipairs(KEYS) do
  redis.call('ZADD', key, ARGV[2], ARGV[3])
  redis.call('PEXPIREAT', key, math.max(tonumber(ARGV[2]), tonumber(redis.call('PTTL', key)) + tonumber(ARGV[1])))
end
return 1`;

export async function reserveHold(booking: { id: string; businessId: string; staffId: string; customerId: string; occupiedFrom: Date; occupiedUntil: Date; holdExpiresAt: Date | null }, capacity: number) {
  if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) throw new AppError(409, 'HOLD_EXPIRED', 'This hold expired. Choose a time again.');
  const from = Math.floor(booking.occupiedFrom.getTime() / 60000);
  const to = Math.ceil(booking.occupiedUntil.getTime() / 60000);
  const keys = Array.from({ length: to - from }, (_, i) => `visit:reservation:${booking.businessId}:${booking.staffId}:${from + i}`);
  try {
    await ensureRedisReady();
    const result = await redis.eval(acquire, keys.length, ...keys, Date.now(), booking.holdExpiresAt.getTime(), booking.id, capacity);
    if (result !== 1) throw new AppError(409, 'SLOT_LOCKED', 'Someone else is holding this time. Choose another slot.');
    await redis.set(`visit:hold:${booking.id}`, JSON.stringify({ customerId: booking.customerId, keys }), 'PXAT', booking.holdExpiresAt.getTime());
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable. Please try again.');
  }
}

export async function requireHold(id: string, customerId: string) {
  try {
    await ensureRedisReady();
    const raw = await redis.get(`visit:hold:${id}`);
    if (!raw || JSON.parse(raw).customerId !== customerId) throw new AppError(409, 'HOLD_EXPIRED', 'Your hold expired. Choose a time again.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'LOCK_UNAVAILABLE', 'Reservations are temporarily unavailable. Please try again.');
  }
}

export async function releaseHold(id: string, customerId: string) {
  await ensureRedisReady();
  const raw = await redis.get(`visit:hold:${id}`);
  if (!raw) return;
  const hold = JSON.parse(raw) as { customerId: string; keys: string[] };
  if (hold.customerId !== customerId) return;
  await redis.eval(`for _, key in ipairs(KEYS) do redis.call('ZREM', key, ARGV[1]) end redis.call('DEL', ARGV[2]) return 1`, hold.keys.length, ...hold.keys, id, `visit:hold:${id}`);
}

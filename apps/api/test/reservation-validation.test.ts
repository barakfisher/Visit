import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { reserveHold } from '../src/scheduling/reservations.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';

after(() => redis.disconnect());

const booking = () => ({
  id: 'validation-only', businessId: 'validation-only', staffId: 'validation-only', customerId: 'validation-only',
  occupiedFrom: new Date('2026-11-01T10:00:00Z'), occupiedUntil: new Date('2026-11-01T10:30:00Z'),
  holdExpiresAt: new Date(Date.now() + 60000),
});
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === expected;

test('reservation rejects missing and expired ownership deadlines before Redis access', async () => {
  await assert.rejects(reserveHold({ ...booking(), holdExpiresAt: null }, 1), code('HOLD_EXPIRED'));
  await assert.rejects(reserveHold({ ...booking(), holdExpiresAt: new Date(0) }, 1), code('HOLD_EXPIRED'));
  await assert.rejects(reserveHold({ ...booking(), holdExpiresAt: new Date(NaN) }, 1), code('HOLD_EXPIRED'));
  assert.equal(redis.status, 'wait');
});

test('reservation rejects invalid capacity, empty intervals and oversized intervals before Redis access', async () => {
  for (const capacity of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(reserveHold(booking(), capacity), code('INVALID_RESERVATION'));
  }
  for (const occupiedUntil of [new Date(NaN), new Date('2026-11-01T10:00:00Z'), new Date('2026-11-01T09:59:00Z'), new Date('2026-11-04T10:01:00Z')]) {
    await assert.rejects(reserveHold({ ...booking(), occupiedUntil }, 1), code('INVALID_RESERVATION'));
  }
  assert.equal(redis.status, 'wait');
});

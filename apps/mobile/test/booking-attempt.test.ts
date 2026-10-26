import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { useBookingAttempt } from '../src/state/BookingAttempt.store';
import type { BookingAttempt } from '../src/types/BookingAttempt.types';
import type { BookingOutcome } from '../src/types/BookingAttempt.types';
import { canDiscardBookingAttempt, isCommittedBookingOutcome } from '../src/lib/BookingAttempt.utils';

const attempt: BookingAttempt = {
  identityId: 'customer-a', providerId: 'business-a', serviceId: 'service-a', staffId: 'staff-a',
  startsAt: '2026-11-01T10:00:00.000Z', idempotencyKey: 'uncertain-attempt-key',
  reviewedService: { name: 'Visit', durationMinutes: 30, priceMinor: null, currency: null },
};
afterEach(() => useBookingAttempt.getState().set(null));

test('uncertain attempt survives successive reads with exact original key and nullable reviewed price', () => {
  useBookingAttempt.getState().set(attempt);
  assert.deepEqual(useBookingAttempt.getState().attempt, attempt);
  assert.equal(useBookingAttempt.getState().attempt?.idempotencyKey, attempt.idempotencyKey);
  assert.equal(useBookingAttempt.getState().attempt?.reviewedService.priceMinor, null);
});

test('clearing a resolved attempt removes all customer and appointment details', () => {
  useBookingAttempt.getState().set(attempt);
  useBookingAttempt.getState().set(null);
  useBookingAttempt.getState().set(null);
  assert.equal(useBookingAttempt.getState().attempt, null);
});

test('unknown, pending, held and committed recovery do not authorize discarding an uncertain key', () => {
  const outcomes: (BookingOutcome | null)[] = [null, ...(['PENDING', 'HELD', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const).map(status => ({ id: 'original-attempt', status }))];
  for (const recovered of outcomes) {
    assert.equal(canDiscardBookingAttempt(recovered), false, `must retain key for ${recovered?.status ?? 'unknown / recovery 404'}`);
  }
});

test('only authoritative cancelled or expired recovery authorizes a new logical attempt', () => {
  for (const status of ['CANCELLED', 'EXPIRED'] as const) {
    assert.equal(canDiscardBookingAttempt({ id: 'original-attempt', status }), true);
  }
});

test('confirmed and terminal fulfilled recoveries are committed and must never reserve again', () => {
  for (const status of ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const) {
    const outcome: BookingOutcome = { id: 'original-attempt', status };
    assert.equal(isCommittedBookingOutcome(outcome), true);
    assert.equal(canDiscardBookingAttempt(outcome), false);
  }
  for (const status of ['PENDING', 'HELD', 'CANCELLED', 'EXPIRED'] as const) {
    assert.equal(isCommittedBookingOutcome({ id: 'original-attempt', status }), false);
  }
  assert.equal(isCommittedBookingOutcome(null), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { upcomingStartDelay } from '../src/lib/UpcomingAppointment.utils';
import { isBookingQuery } from '../src/lib/BookingQueries.utils';

test('upcoming timer refreshes after start without zero, negative or overflowing delays', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(upcomingStartDelay('2026-10-27T12:00:01Z', now), 1001);
  assert.equal(upcomingStartDelay('2026-10-27T12:00:00Z', now), 1);
  assert.equal(upcomingStartDelay('2026-10-26T12:00:00Z', now), 1);
  assert.equal(upcomingStartDelay('2099-10-27T12:00:00Z', now), 2147483647);
  assert.equal(upcomingStartDelay('', now), null);
  assert.equal(upcomingStartDelay('invalid', now), null);
  assert.equal(upcomingStartDelay('2026-10-27T12:00:00Z', NaN), null);
  assert.equal(upcomingStartDelay('2026-10-27T12:00:00Z', Infinity), null);
  assert.equal(upcomingStartDelay('2026-10-27T12:00:00Z', -Infinity), null);
});

test('booking mutation invalidation covers all owned reads and capacity without invalidating unrelated caches', () => {
  for (const prefix of ['me', 'consumer', 'provider', 'booking-details', 'appointment-history', 'availability', 'booking-calendar']) {
    assert.equal(isBookingQuery([prefix]), true, prefix);
    assert.equal(isBookingQuery([prefix, 'context', null]), true, prefix);
  }
  for (const key of [[], [null], [undefined], ['catalog'], ['services'], ['session'], ['availability-extra']]) assert.equal(isBookingQuery(key), false);
});

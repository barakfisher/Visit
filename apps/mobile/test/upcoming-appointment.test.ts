import assert from 'node:assert/strict';
import test from 'node:test';
import { upcomingStartDelay, visibleAppointments } from '../src/lib/UpcomingAppointment.utils';
import type { UpcomingAppointment } from '../src/types/UpcomingAppointment.types';
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

test('Home lists today, falls back to the next appointment, and a business page shows only the next one', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const at = (id: string, startsAt: string, status: UpcomingAppointment['status'] = 'CONFIRMED') => ({ id, startsAt, status }) as UpcomingAppointment;
  const next = at('next', '2026-10-27T13:00:00Z'), later = at('later', '2026-10-27T14:00:00Z'), tomorrow = at('tomorrow', '2026-10-28T09:00:00Z');
  const ids = (items: UpcomingAppointment[]) => items.map(item => item.id);
  assert.deepEqual(ids(visibleAppointments({ booking: next, today: [next, later] }, now, false)), ['next', 'later']);
  assert.deepEqual(ids(visibleAppointments({ booking: tomorrow, today: [] }, now, false)), ['tomorrow']);
  assert.deepEqual(ids(visibleAppointments({ booking: next, today: [next, later] }, now, true)), ['next']);
  assert.deepEqual(visibleAppointments({ booking: null, today: [] }, now, false), []);
  assert.deepEqual(ids(visibleAppointments({ booking: next, today: [at('started', '2026-10-27T11:59:00Z'), next, at('gone', '2026-10-27T15:00:00Z', 'CANCELLED')] }, now, false)), ['next']);
});

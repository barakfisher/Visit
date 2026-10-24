import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCapacity, maximumConcurrentBookings, occupiedInterval } from '../src/scheduling/intervals.js';

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
const interval = (from: number, until: number) => ({ startsAt: at(from), endsAt: at(until) });

test('occupied range includes both buffers around the service duration', () => {
  assert.deepEqual(occupiedInterval(at(60), 30, 10, 15), interval(50, 105));
});

test('half-open ranges allow adjacent bookings', () => {
  assert.equal(assertCapacity(interval(60, 90), [interval(30, 60)], 1), true);
  assert.equal(maximumConcurrentBookings([interval(30, 60), interval(60, 90)]), 1);
});

test('overlap is detected when start times differ and buffers are applied', () => {
  const candidate = occupiedInterval(at(65), 30, 10, 0);
  assert.equal(assertCapacity(candidate, [interval(50, 70)], 1), false);
});

test('parallel capacity applies to the entire candidate interval', () => {
  assert.equal(assertCapacity(interval(40, 60), [interval(35, 45)], 2), true);
  assert.equal(assertCapacity(interval(40, 60), [interval(35, 55), interval(45, 65)], 2), false);
});

test('invalid ranges and capacity fail closed', () => {
  assert.throws(() => maximumConcurrentBookings([interval(30, 30)]), RangeError);
  assert.throws(() => assertCapacity(interval(10, 20), [], 0), RangeError);
});

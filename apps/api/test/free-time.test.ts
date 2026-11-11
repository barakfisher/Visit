import assert from 'node:assert/strict';
import test from 'node:test';
import { FREE_TIME_STEP_MINUTES, dayFreeTime, presentFreeGap, subtractIntervals, type FreeTimeStaff } from '../src/scheduling/free-time.js';

const zone = 'Asia/Jerusalem', date = '2026-11-11';
// Israel is UTC+2 in November.
const at = (local: string) => new Date(`${date}T${local}:00+02:00`);
const span = (from: string, until: string) => ({ startsAt: at(from), endsAt: at(until) });
const nineToFive = [{ startLocal: '09:00', endLocal: '17:00' }];
const staff = (patch: Partial<FreeTimeStaff> = {}): FreeTimeStaff => ({ id: 'barak', displayName: 'Barak', windows: nineToFive, busy: [], shortestMinutes: 25, ...patch });
const early = at('06:00');
const gaps = (result: ReturnType<typeof dayFreeTime>) => result.free.map(gap => presentFreeGap(gap, zone, 0)).map(gap => `${gap.startLocal}-${gap.endLocal}`);

test('subtracting keeps the parts outside every cut, half-open', () => {
  assert.deepEqual(subtractIntervals([span('09:00', '17:00')], [span('10:00', '11:00'), span('16:00', '18:00')]), [span('09:00', '10:00'), span('11:00', '16:00')]);
  assert.deepEqual(subtractIntervals([span('09:00', '10:00')], [span('10:00', '11:00')]), [span('09:00', '10:00')]);
});

test('a day with no appointments is one gap across the working hours', () => {
  const result = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff()] });
  assert.equal(result.closed, false);
  assert.deepEqual(gaps(result), ['09:00-17:00']);
});

test('appointments and blocks split the day into one gap each side', () => {
  const result = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ busy: [span('14:45', '15:30'), span('12:00', '13:00'), span('16:30', '16:55')] })] });
  assert.deepEqual(gaps(result), ['09:00-12:00', '13:00-14:45', '15:30-16:30']);
});

test('a gap shorter than the shortest service is left out', () => {
  const result = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ shortestMinutes: 30, busy: [span('09:00', '12:00'), span('12:20', '17:00')] })] });
  assert.deepEqual(gaps(result), []);
  const exact = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ shortestMinutes: 20, busy: [span('09:00', '12:00'), span('12:20', '17:00')] })] });
  assert.deepEqual(gaps(exact), ['12:00-12:20']);
});

test('time already past is not free, and a running gap starts on the next step', () => {
  const result = dayFreeTime({ date, timezone: zone, now: at('14:07'), businessWindows: nineToFive, staff: [staff()] });
  const start = new Date(Math.ceil(at('14:07').getTime() / (FREE_TIME_STEP_MINUTES * 60_000)) * FREE_TIME_STEP_MINUTES * 60_000);
  assert.deepEqual(result.free.map(gap => gap.startsAt), [start]);
  assert.equal(dayFreeTime({ date, timezone: zone, now: at('18:00'), businessWindows: nineToFive, staff: [staff()] }).free.length, 0);
});

test('a day without hours is closed; a fully blocked day is not', () => {
  const closed = dayFreeTime({ date, timezone: zone, now: early, businessWindows: [], staff: [staff()] });
  assert.deepEqual({ closed: closed.closed, free: closed.free.length }, { closed: true, free: 0 });
  const offDay = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ windows: [] })] });
  assert.equal(offDay.closed, true);
  const blocked = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ busy: [{ startsAt: at('00:00'), endsAt: new Date(at('00:00').getTime() + 86_400_000) }] })] });
  assert.deepEqual({ closed: blocked.closed, free: blocked.free.length }, { closed: false, free: 0 });
});

test('staff hours narrow the business hours, and a staff member with no service has no gaps', () => {
  const result = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ windows: [{ startLocal: '12:00', endLocal: '20:00' }] })] });
  assert.deepEqual(gaps(result), ['12:00-17:00']);
  const idle = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ shortestMinutes: null })] });
  assert.deepEqual({ closed: idle.closed, free: idle.free.length }, { closed: false, free: 0 });
});

test('a new appointment in a gap starts after the buffer before it', () => {
  const [gap] = dayFreeTime({ date, timezone: zone, now: early, businessWindows: nineToFive, staff: [staff({ busy: [span('09:00', '10:00')] })] }).free;
  const shown = presentFreeGap(gap!, zone, 10);
  assert.deepEqual({ startLocal: shown.startLocal, bookLocal: shown.bookLocal }, { startLocal: '10:00', bookLocal: '10:10' });
});

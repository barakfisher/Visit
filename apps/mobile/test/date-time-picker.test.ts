import assert from 'node:assert/strict';
import test from 'node:test';
import { pickableDays, pickTime, timeParts, TIME_PICKER_HOURS, TIME_PICKER_MINUTES, TIME_PICKER_MINUTE_STEP } from '../src/lib/DateTimePicker';

test('a month offers only the days between its bounds', () => {
  const days = pickableDays('2026-11', '2026-11-11');
  assert.equal(days[0], '2026-11-11'); assert.equal(days.at(-1), '2026-11-30'); assert.equal(days.length, 20);
  assert.deepEqual(pickableDays('2026-12', '2026-11-11', '2026-12-02'), ['2026-12-01', '2026-12-02']);
  assert.deepEqual(pickableDays('2026-10', '2026-11-11'), []);
  assert.deepEqual(pickableDays('2026-13', ''), []);
});

test('the time picker covers a whole day in its minute step', () => {
  assert.equal(TIME_PICKER_HOURS.length, 24); assert.equal(TIME_PICKER_HOURS[0], '00'); assert.equal(TIME_PICKER_HOURS.at(-1), '23');
  assert.equal(TIME_PICKER_MINUTES.length * TIME_PICKER_MINUTE_STEP, 60);
  for (const minute of TIME_PICKER_MINUTES) assert.equal(Number(minute) % TIME_PICKER_MINUTE_STEP, 0);
});

test('choosing an hour keeps the minutes and choosing minutes keeps the hour', () => {
  assert.equal(pickTime('12:30', { hour: '09' }), '09:30');
  assert.equal(pickTime('12:30', { minute: TIME_PICKER_MINUTES[1]! }), `12:${TIME_PICKER_MINUTES[1]}`);
  assert.equal(pickTime('', { hour: '09' }), `09:${TIME_PICKER_MINUTES[0]}`);
  assert.equal(pickTime('', { minute: '45' }), `${TIME_PICKER_HOURS[0]}:45`);
  assert.deepEqual(timeParts('24:00'), { hour: '', minute: '' }); assert.deepEqual(timeParts('07:05'), { hour: '07', minute: '05' });
});

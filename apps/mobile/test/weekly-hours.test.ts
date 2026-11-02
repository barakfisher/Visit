import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INTERVAL, WEEKDAYS, applyHoursForm, effectiveWeek, emptyHoursForm, formatIntervals, groupWeek, toggleFormDay, validateHoursForm, type Week } from '../src/lib/WeeklyHours';

const nine = { startLocal: '09:00', endLocal: '19:00' }, morning = { startLocal: '08:00', endLocal: '12:00' }, evening = { startLocal: '16:00', endLocal: '20:00' };
// Sun, Wed, Thu 09–19; Mon and Tue split; Fri and Sat closed.
const week: Week = [[nine], [evening, morning], [morning, evening], [nine], [nine], [], []];

test('the summary groups days with identical hours in week order, Sunday first', () => {
  assert.deepEqual(groupWeek(week), [
    { days: [0, 3, 4], intervals: [nine] },
    { days: [1, 2], intervals: [morning, evening] },
    { days: [5, 6], intervals: [] },
  ]);
  assert.equal(formatIntervals([morning, evening]), '08:00–12:00 | 16:00–20:00');
});

test('a closed week is one closed group', () => {
  assert.deepEqual(groupWeek(WEEKDAYS.map(() => [])), [{ days: [...WEEKDAYS], intervals: [] }]);
});

test('a staff member without a week of their own shows and starts from the business week', () => {
  const closed = WEEKDAYS.map(() => []);
  assert.deepEqual(effectiveWeek(closed, week), { week, inherited: true });
  assert.deepEqual(effectiveWeek(week, closed), { week, inherited: false });
  assert.deepEqual(effectiveWeek(closed), { week: closed, inherited: false });
});

test('the first chosen day loads its hours; later days keep the form hours', () => {
  let form = toggleFormDay(emptyHoursForm(), 1, week);
  assert.deepEqual(form, { days: [1], closed: false, intervals: [evening, morning] });
  form = toggleFormDay(form, 5, week);
  assert.deepEqual(form, { days: [1, 5], closed: false, intervals: [evening, morning] });
  assert.deepEqual(toggleFormDay(form, 1, week).days, [5]);
  assert.deepEqual(toggleFormDay(emptyHoursForm(), 6, week), { days: [6], closed: true, intervals: [DEFAULT_INTERVAL] });
});

test('saving applies the form to the chosen days only, sorted, without touching the source week', () => {
  const before = structuredClone(week);
  const next = applyHoursForm(week, { days: [0, 6], closed: false, intervals: [evening, morning] });
  assert.deepEqual(next[0], [morning, evening]); assert.deepEqual(next[6], [morning, evening]);
  assert.deepEqual(next.slice(1, 6), week.slice(1, 6));
  assert.deepEqual(applyHoursForm(week, { days: [3], closed: true, intervals: [nine] })[3], []);
  assert.deepEqual(week, before);
});

test('the form reports each problem on its field', () => {
  assert.deepEqual(validateHoursForm({ days: [], closed: false, intervals: [nine] }, week, false), { days: 'days' });
  assert.deepEqual(validateHoursForm({ days: [0], closed: false, intervals: [{ startLocal: '9', endLocal: '24:00' }] }, week, false), { 'start.0': 'format', 'end.0': 'format' });
  assert.deepEqual(validateHoursForm({ days: [0], closed: false, intervals: [{ startLocal: '19:00', endLocal: '09:00' }] }, week, false), { 'end.0': 'order' });
  assert.deepEqual(validateHoursForm({ days: [0], closed: false, intervals: [nine, evening] }, week, false), { 'start.1': 'overlap' });
  // Adjacent ranges are allowed, as in the API.
  assert.deepEqual(validateHoursForm({ days: [0], closed: false, intervals: [morning, { startLocal: '12:00', endLocal: '13:00' }] }, week, false), {});
  assert.deepEqual(validateHoursForm({ days: [0], closed: true, intervals: [{ startLocal: 'x', endLocal: 'y' }] }, week, false), {});
});

test('a staff week cannot be closed on every day, because an empty staff week means business hours', () => {
  const allOpenDays = WEEKDAYS.filter(day => week[day]!.length);
  assert.deepEqual(validateHoursForm({ days: [...allOpenDays], closed: true, intervals: [] }, week, true), { form: 'staffClosed' });
  assert.deepEqual(validateHoursForm({ days: [...allOpenDays], closed: true, intervals: [] }, week, false), {});
  assert.deepEqual(validateHoursForm({ days: [0], closed: true, intervals: [] }, week, true), {});
});

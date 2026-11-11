import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GRID_HOURS, SLOT_MINUTES, addDays, daySegments, gridHours, isOpen, localPoint, periodDates, placeSegments, gridSlots, stepPeriod, weekStart, type Segment } from '../src/lib/CalendarGrid';

const zone = 'Asia/Jerusalem';
// 2026-11-11 is a Wednesday; its week starts Sunday 2026-11-08. Israel is UTC+2 in November.
const wednesday = '2026-11-11', sunday = '2026-11-08';
const item = (key: string, startsAt: string, endsAt: string) => ({ key, item: { startsAt, endsAt } });
const segment = (key: string, startMinute: number, endMinute: number, date = wednesday): Segment<null> => ({ key, date, startMinute, endMinute, item: null });

test('a week runs Sunday to Saturday and steps a week at a time; a day steps a day', () => {
  assert.equal(weekStart(wednesday), sunday);
  assert.equal(weekStart(sunday), sunday);
  assert.deepEqual(periodDates(wednesday, 'week'), [sunday, '2026-11-09', '2026-11-10', wednesday, '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.deepEqual(periodDates(wednesday, 'day'), [wednesday]);
  assert.equal(stepPeriod(wednesday, 'week', 1), addDays(sunday, 7));
  assert.equal(stepPeriod(wednesday, 'week', -1), addDays(sunday, -7));
  assert.equal(stepPeriod(wednesday, 'day', -1), '2026-11-10');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('instants are read in the business zone, not the device zone', () => {
  assert.deepEqual(localPoint('2026-11-11T22:30:00Z', zone), { date: '2026-11-12', minute: 30 });
});

test('an appointment sits on its local day; one crossing midnight is split and ends at 24:00', () => {
  const dates = periodDates(wednesday, 'week');
  assert.deepEqual(daySegments([item('a', '2026-11-11T08:00:00Z', '2026-11-11T08:30:00Z')], dates, zone).map(({ date, startMinute, endMinute }) => ({ date, startMinute, endMinute })), [{ date: wednesday, startMinute: 600, endMinute: 630 }]);
  assert.deepEqual(daySegments([item('b', '2026-11-11T21:00:00Z', '2026-11-11T23:00:00Z')], dates, zone).map(({ date, startMinute, endMinute }) => ({ date, startMinute, endMinute })), [
    { date: wednesday, startMinute: 23 * 60, endMinute: 24 * 60 }, { date: '2026-11-12', startMinute: 0, endMinute: 60 },
  ]);
  // Outside the period: not drawn.
  assert.deepEqual(daySegments([item('c', '2026-11-20T08:00:00Z', '2026-11-20T09:00:00Z')], dates, zone), []);
});

test('the grid spans the earliest opening to the latest closing, widened by anything outside', () => {
  const hours = [{ date: sunday, windows: [{ startLocal: '10:30', endLocal: '17:00' }] }, { date: wednesday, windows: [{ startLocal: '10:00', endLocal: '12:00' }, { startLocal: '16:00', endLocal: '21:15' }] }];
  assert.deepEqual(gridHours(hours, []), { start: 10, end: 22 });
  assert.deepEqual(gridHours(hours, [segment('late', 22 * 60, 23 * 60 + 30)]), { start: 10, end: 24 });
  assert.deepEqual(gridHours([{ date: sunday, windows: [] }], []), { ...DEFAULT_GRID_HOURS });
  assert.deepEqual(gridHours([], [segment('night', 23 * 60, 24 * 60)]), { start: 23, end: 24 });
});

test('overlapping pieces share lanes and their group lane count; separate ones take the whole width', () => {
  const placed = placeSegments([segment('a', 600, 660), segment('b', 630, 700), segment('c', 665, 690), segment('d', 720, 750)]);
  const by = Object.fromEntries(placed.map(piece => [piece.key, `${piece.lane}/${piece.lanes}`]));
  assert.deepEqual(by, { a: '0/2', b: '1/2', c: '0/2', d: '0/1' });
  // A piece that ends as the next starts does not overlap it.
  assert.deepEqual(placeSegments([segment('x', 600, 630), segment('y', 630, 660)]).map(piece => piece.lanes), [1, 1]);
});

test('open hours and the empty slots are read in local minutes', () => {
  const day = { date: wednesday, windows: [{ startLocal: '09:00', endLocal: '12:00' }] };
  assert.equal(isOpen(day, 9 * 60), true);
  assert.equal(isOpen(day, 12 * 60), false);
  assert.equal(isOpen(undefined, 600), false);
  const slots = gridSlots({ start: 8, end: 10 });
  assert.equal(slots.length, 2 * 60 / SLOT_MINUTES);
  assert.equal(slots[0], '08:00');
  assert.equal(slots[1], `08:${String(SLOT_MINUTES).padStart(2, '0')}`);
});

import { calendarColumns, calendarMonthTitle } from '../src/lib/CalendarColumns';
import type { AgendaAppointment } from '../src/types/ProviderAgenda.types';
import type { TimeBlock } from '../src/types/TimeBlocks.types';

const booking = (id: string, startsAt: string, endsAt: string, status: AgendaAppointment['status'] = 'CONFIRMED'): AgendaAppointment => ({ id, status, revision: 1, startsAt, endsAt, customer: { displayName: id, phone: null, email: null }, service: { name: 'Cut' }, staff: { displayName: 'Barak' } });
const timedBlock: TimeBlock = { id: 'lunch', startsAt: '2026-11-11T11:00:00Z', endsAt: '2026-11-11T11:30:00Z', allDay: false, reason: null, staff: null, fromDate: wednesday, toDate: wednesday, startLocal: '13:00', endLocal: '13:30' };
const holiday: TimeBlock = { id: 'off', startsAt: '2026-11-11T22:00:00Z', endsAt: '2026-11-13T22:00:00Z', allDay: true, reason: null, staff: null, fromDate: '2026-11-12', toDate: '2026-11-13' };

test('columns leave cancelled appointments out, grey ended ones and lift whole-day blocks above the grid', () => {
  const now = Date.parse('2026-11-11T09:00:00Z');
  const { bookings, columns } = calendarColumns({ locale: 'en', timezone: zone, today: wednesday, now, dates: periodDates(wednesday, 'week'), agenda: {
    hours: [], blocks: [timedBlock, holiday],
    bookings: [booking('done', '2026-11-11T07:00:00Z', '2026-11-11T07:30:00Z'), booking('ahead', '2026-11-11T10:00:00Z', '2026-11-11T10:30:00Z'), booking('kept', '2026-11-11T10:00:00Z', '2026-11-11T10:20:00Z', 'COMPLETED'), booking('gone', '2026-11-11T12:00:00Z', '2026-11-11T12:30:00Z', 'CANCELLED')],
  } });
  assert.deepEqual(bookings.map(row => row.id), ['done', 'ahead', 'kept']);
  const day = columns.find(column => column.date === wednesday)!;
  assert.equal(day.today, true);
  assert.deepEqual(day.entries.map(piece => [piece.key, piece.item.kind === 'appointment' && piece.item.ended]), [['appointment-done', true], ['appointment-ahead', false], ['appointment-kept', true], ['block-lunch', false]]);
  assert.deepEqual(columns.filter(column => column.allDay.length).map(column => column.date), ['2026-11-12', '2026-11-13']);
});

test('the month title names both months when a week crosses one', () => {
  assert.equal(calendarMonthTitle(sunday, '2026-11-14', 'en'), 'November 2026');
  assert.match(calendarMonthTitle('2026-11-29', '2026-12-05', 'en'), /November.*December 2026/);
});

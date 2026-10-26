import assert from 'node:assert/strict';
import test from 'node:test';
import { addBookingDays, availableBookingSlots, bookingMonthCells, preferredBookingPage, shiftBookingMonth, validBookingDate } from '../src/lib/CompactBooking.utils';
import type { Slot } from '../src/types/flows';
const slot = (time: string, staffId = 'staff'): Slot => ({ startsAt: `2026-11-01T${time}:00Z`, localTime: time, staffId, staffName: staffId, utcOffset: '+02:00', available: true, locked: false });
test('calendar is timezone-independent, leap-aware and obeys server-provided date availability', () => {
  assert.equal(validBookingDate('2026-02-30'), false); assert.equal(validBookingDate('2028-02-29'), true);
  assert.equal(addBookingDays('2026-12-31', 1), '2027-01-01'); assert.equal(shiftBookingMonth('2026-12', 1), '2027-01');
  const cells = bookingMonthCells('2028-02', ['2028-02-29'], '2028-02-29', 'he-IL');
  assert.equal(cells.filter(cell => cell?.available).length, 1); assert.equal(cells.find(cell => cell?.available)?.date, '2028-02-29');
  assert.ok(cells.find(cell => cell?.date === '2028-02-29')?.selected); assert.deepEqual(bookingMonthCells('', [], '', 'en'), []);
});
test('only real available slots appear and ranking preserves exact staff and absolute identities', () => {
  const input = [slot('11:00'), { ...slot('09:00'), available: false }, { ...slot('10:00'), locked: true }, slot('12:00', 'other'), slot('11:00', 'a')];
  const available = availableBookingSlots(input, 'staff:2026-11-01T11:00:00Z');
  assert.deepEqual(available.map(item => item.staffId), ['a', 'other']); assert.equal(input.length, 5);
  assert.deepEqual(availableBookingSlots([], null), []);
});
test('nearby pages are chronological around preference and remain bounded at either edge', () => {
  const slots = Array.from({ length: 12 }, (_, index) => slot(`${String(8 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`));
  assert.equal(preferredBookingPage(slots, '11:00'), 3);
  assert.equal(preferredBookingPage(slots, '00:00'), 0); assert.equal(preferredBookingPage(slots, '23:59'), 6);
  assert.equal(preferredBookingPage(slots, '25:00'), 0); assert.equal(preferredBookingPage([], '11:00'), 0);
});
test('calendar rejects malformed dates and impossible month boundaries', () => {
  for (const date of ['', '2026-2-01', '2026-02-1', '2026-00-01', '2026-13-01', '2026-04-31', '1900-02-29', '2026-01-01T00:00:00Z']) {
    assert.equal(validBookingDate(date), false, date);
  }
  assert.equal(validBookingDate('2000-02-29'), true);
  for (const month of ['', '2026-2', '2026-00', '2026-13']) assert.deepEqual(bookingMonthCells(month, [], '', 'en-US'), []);
});
test('date arithmetic handles negative, zero and leap transitions and rejects invalid inputs', () => {
  assert.equal(addBookingDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addBookingDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addBookingDays('2026-01-01', 0), '2026-01-01');
  assert.equal(shiftBookingMonth('2026-01', -1), '2025-12');
  assert.equal(shiftBookingMonth('2026-01', 12), '2027-01');
  assert.equal(shiftBookingMonth('2026-01', 0), '2026-01');
  for (const count of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => addBookingDays('2026-01-01', count), RangeError);
    assert.throws(() => shiftBookingMonth('2026-01', count), RangeError);
  }
  assert.throws(() => addBookingDays('2026-02-30', 1), RangeError);
  assert.throws(() => shiftBookingMonth('2026-13', 1), RangeError);
});
test('calendar cells align Sunday-first weeks without leaking adjacent-month dates', () => {
  const february = bookingMonthCells('2026-02', [], '', 'en-US');
  assert.equal(february.length, 28);
  assert.equal(february[0]?.date, '2026-02-01');
  assert.equal(february[27]?.date, '2026-02-28');
  assert.ok(february.every(cell => cell !== null && !cell.available && !cell.selected));
  const august = bookingMonthCells('2026-08', ['2026-07-31', '2026-08-31', '2026-09-01'], '2026-09-01', 'en-US');
  assert.equal(august.length, 42);
  assert.ok(august.slice(0, 6).every(cell => cell === null));
  assert.ok(august.slice(37).every(cell => cell === null));
  assert.equal(august.filter(cell => cell !== null).length, 31);
  assert.deepEqual(august.filter(cell => cell?.available).map(cell => cell?.date), ['2026-08-31']);
  assert.ok(august.every(cell => !cell?.selected));
});
test('calendar labels and selections remain stable in English and Hebrew', () => {
  const dates = Object.freeze(['2028-02-29', '2028-02-29']);
  for (const language of ['en-US', 'he-IL']) {
    const selected = bookingMonthCells('2028-02', dates, '2028-02-29', language).find(cell => cell?.selected);
    assert.equal(selected?.day, '29');
    assert.equal(selected?.available, true);
    assert.ok(selected?.label.startsWith('2028-02-29 · '));
  }
  assert.deepEqual(dates, ['2028-02-29', '2028-02-29']);
});
test('slot filtering preserves input order and objects while returning chronological stable identities', () => {
  const latest = Object.freeze(slot('13:00'));
  const earliest = Object.freeze(slot('08:00'));
  const sameTime = Object.freeze(slot('08:00', 'a'));
  const input = Object.freeze([latest, earliest, sameTime]);
  assert.deepEqual(availableBookingSlots(input, null), [sameTime, earliest, latest]);
  assert.deepEqual(input, [latest, earliest, sameTime]);
  assert.deepEqual(availableBookingSlots([slot('09:00', 'a'), slot('09:00', 'b')], 'a:2026-11-01T09:00:00Z').map(item => item.staffId), ['b']);
  assert.deepEqual(availableBookingSlots([{ ...slot('09:00'), available: false }, { ...slot('10:00'), locked: true }], null), []);
});
test('preference handles small pages, invalid input, nearest ties and custom page sizes', () => {
  const slots = [slot('08:00'), slot('09:00'), slot('10:00'), slot('11:00'), slot('12:00'), slot('13:00'), slot('14:00'), slot('15:00')];
  for (const preferred of ['', '9:00', '24:00', '12:60', '12:00:00', ' 12:00']) assert.equal(preferredBookingPage(slots, preferred), 0);
  assert.equal(preferredBookingPage(slots.slice(0, 2), '23:59'), 0);
  assert.equal(preferredBookingPage(slots, '10:30', 2), 1);
  assert.equal(preferredBookingPage(slots, '15:00', 2), 6);
  assert.equal(preferredBookingPage(slots, '08:00', 2), 0);
});
test('calendar renders the final four-digit year without overflowing into an invalid month', () => {
  assert.equal(validBookingDate('9999-12-31'), true);
  const cells = bookingMonthCells('9999-12', ['9999-12-31'], '9999-12-31', 'en-US');
  const days = cells.filter(cell => cell !== null);
  assert.equal(cells.length % 7, 0);
  assert.equal(days.length, 31);
  assert.equal(days[0]?.date, '9999-12-01');
  assert.equal(days[30]?.date, '9999-12-31');
  assert.ok(days.every(cell => validBookingDate(cell.date)));
  assert.deepEqual(days.filter(cell => cell.available).map(cell => cell.date), ['9999-12-31']);
  assert.equal(days[30]?.selected, true);
});

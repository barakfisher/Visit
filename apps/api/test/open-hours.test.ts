import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeLocalWindows, openHours, type WeekdayWindow } from '../src/scheduling/open-hours.js';

// 2026-11-08 is a Sunday (weekday 0); 2026-11-13 a Friday (5).
const sunday = '2026-11-08', friday = '2026-11-13';
const on = (weekday: number, startLocal: string, endLocal: string): WeekdayWindow => ({ weekday, startLocal, endLocal });
const business = [on(0, '09:00', '17:00'), on(5, '08:00', '12:00')];

test('touching and overlapping windows join; separate ones stay apart', () => {
  assert.deepEqual(mergeLocalWindows([{ startLocal: '13:00', endLocal: '15:00' }, { startLocal: '09:00', endLocal: '12:00' }, { startLocal: '12:00', endLocal: '12:30' }]), [{ startLocal: '09:00', endLocal: '12:30' }, { startLocal: '13:00', endLocal: '15:00' }]);
});

test('with no active staff a day is open by the business hours alone', () => {
  assert.deepEqual(openHours([sunday, friday], business, []), [
    { date: sunday, windows: [{ startLocal: '09:00', endLocal: '17:00' }] },
    { date: friday, windows: [{ startLocal: '08:00', endLocal: '12:00' }] },
  ]);
});

test('a staff member without hours of their own works the business hours', () => {
  assert.deepEqual(openHours([sunday], business, [{ windows: [] }])[0]!.windows, [{ startLocal: '09:00', endLocal: '17:00' }]);
});

test('open is the union of who works, each inside the business hours', () => {
  const staff = [{ windows: [on(0, '07:00', '11:00')] }, { windows: [on(0, '14:00', '20:00')] }];
  assert.deepEqual(openHours([sunday], business, staff)[0]!.windows, [{ startLocal: '09:00', endLocal: '11:00' }, { startLocal: '14:00', endLocal: '17:00' }]);
});

test('a day nobody works is closed, even when the business has hours', () => {
  assert.deepEqual(openHours([friday], business, [{ windows: [on(0, '09:00', '17:00')] }])[0]!.windows, []);
  assert.deepEqual(openHours(['2026-11-14'], business, [])[0]!.windows, []);
});

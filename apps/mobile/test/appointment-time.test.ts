import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { appointmentTime, localDate, timePolicyNote } from '../src/lib/appointmentTime';
import { bookingCalendarBody } from '../src/lib/calendar';
test('Israeli dates, spring gap and fold display use the stored zone independently of device TZ', () => {
  const prior = process.env.TZ;
  try {
    for (const device of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
      process.env.TZ = device;
      assert.equal(localDate(PILOT_TIMEZONE, new Date('2026-10-24T21:30:00Z')), '2026-10-25');
      assert.equal(appointmentTime('2026-03-27T00:00:00Z', PILOT_TIMEZONE, 'en'), '03:00');
      assert.equal(appointmentTime('2026-10-24T22:30:00Z', PILOT_TIMEZONE, 'en'), '01:30 (first occurrence)');
      assert.equal(appointmentTime('2026-10-24T23:30:00Z', PILOT_TIMEZONE, 'en'), '01:30 (second occurrence)');
      assert.match(appointmentTime('2026-10-24T23:30:00Z', PILOT_TIMEZONE, 'he'), /מופע שני/);
      assert.equal(appointmentTime('2026-11-02T08:30:00Z', PILOT_TIMEZONE, 'en'), '10:30');
    }
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
  assert.match(timePolicyNote(PILOT_TIMEZONE, 'en'), /Israeli time/);
  assert.match(timePolicyNote('America/New_York', 'en'), /existing timezone: America\/New_York/);
});
test('calendar exports preserve the exact fold instant and UTC Z stamps', () => {
  const booking = { id: 'fold', startsAt: '2026-10-24T23:30:00Z', endsAt: '2026-10-25T00:00:00Z', business: { name: 'Studio', timezone: PILOT_TIMEZONE }, service: { name: 'Visit' }, staff: { displayName: 'Alex' } };
  const before = JSON.stringify(booking);
  const ics = bookingCalendarBody(booking, new Date('2026-10-01T12:00:00Z'));
  assert.match(ics, /DTSTART:20261024T233000Z/);
  assert.match(ics, /DTEND:20261025T000000Z/);
  assert.match(ics, /X-WR-TIMEZONE:Asia\/Jerusalem/);
  assert.equal(JSON.stringify(booking), before);
});

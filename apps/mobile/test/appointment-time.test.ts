import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { appointmentTime, localDate, timePolicyNote } from '../src/lib/appointmentTime';
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { appointmentSpan, appointmentTime, businessTimezoneLabel, dateRange, localDate, timePolicyNote } from '../src/lib/appointmentTime';
import { isolateLtr, translate } from '../src/i18n/messages';
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

test('an agenda appointment names its date once and keeps its times in one left-to-right run', () => {
  const prior = process.env.TZ;
  try {
    for (const device of ['America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = device;
      assert.equal(appointmentSpan('2026-11-03T08:00:00Z', '2026-11-03T08:30:00Z', PILOT_TIMEZONE, 'en', false), isolateLtr('10:00–10:30'));
      assert.equal(appointmentSpan('2026-11-03T08:00:00Z', '2026-11-03T08:30:00Z', PILOT_TIMEZONE, 'en', true), `3 Nov 2026 · ${isolateLtr('10:00–10:30')}`);
      assert.equal(appointmentSpan('2026-11-03T08:00:00Z', '2026-11-03T08:30:00Z', PILOT_TIMEZONE, 'he', true), `3 בנוב׳ 2026 · ${isolateLtr('10:00–10:30')}`);
      // 21:30 UTC is already the next day in Israel; an appointment across midnight names both dates.
      assert.equal(appointmentSpan('2026-11-03T21:30:00Z', '2026-11-03T22:30:00Z', PILOT_TIMEZONE, 'en', true), `3 Nov 2026 · ${isolateLtr('23:30')} – 4 Nov 2026 · ${isolateLtr('00:30')}`);
    }
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test('the agenda week reads as a date range, not ISO dates, across months and years', () => {
  // ICU versions differ only in the spacing around the dash, so spaces are left out of the comparison.
  const range = (from: string, to: string, locale: 'he' | 'en') => dateRange(from, to, locale).replace(/\s/g, '');
  assert.equal(range('2026-11-01', '2026-11-07', 'en'), '1–7Nov2026');
  assert.equal(range('2026-11-01', '2026-11-07', 'he'), '1–7בנוב׳2026');
  assert.equal(range('2026-11-29', '2026-12-05', 'en'), '29Nov–5Dec2026');
  assert.equal(range('2026-12-27', '2027-01-02', 'en'), '27Dec2026–2Jan2027');
  assert.doesNotMatch(dateRange('2026-12-27', '2027-01-02', 'he'), /\d{4}-\d{2}-\d{2}/);
});

test('the pilot time zone is named in the viewer language; an older zone stays as stored', () => {
  assert.equal(businessTimezoneLabel(PILOT_TIMEZONE, 'he'), translate('he', 'time.israel'));
  assert.equal(businessTimezoneLabel(PILOT_TIMEZONE, 'en'), translate('en', 'time.israel'));
  assert.equal(businessTimezoneLabel('America/New_York', 'he'), 'America/New_York');
});

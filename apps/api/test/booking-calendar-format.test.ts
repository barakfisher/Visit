import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingCalendarBody, escapeCalendarText, foldCalendarLine } from '../src/repositories/BookingCalendar.utils.js';
import type { CalendarAppointment } from '../src/repositories/BookingCalendar.types.js';
const booking: CalendarAppointment = { id: 'fold', startsAt: '2026-10-24T23:30:00Z', endsAt: '2026-10-25T00:00:00Z', revision: 1, updatedAt: '2026-10-01T12:00:00Z', business: { name: 'Studio', timezone: 'Asia/Jerusalem' }, service: { name: 'Consultation' }, staff: { displayName: 'Alex' } };
test('calendar keeps absolute fold/gap instants, stable UID, persisted timestamp and revision', () => {
  const body = bookingCalendarBody(booking), original = JSON.stringify(booking);
  assert.match(body, /DTSTART:20261024T233000Z/); assert.match(body, /DTEND:20261025T000000Z/); assert.match(body, /UID:fold@visit.app/); assert.match(body, /SEQUENCE:1/); assert.match(body, /DTSTAMP:20261001T120000Z/);
  assert.equal(bookingCalendarBody(booking), body); assert.equal(JSON.stringify(booking), original);
  const gap = bookingCalendarBody({ ...booking, startsAt: '2026-03-27T00:00:00Z', endsAt: '2026-03-27T00:30:00Z' }); assert.match(gap, /DTSTART:20260327T000000Z/);
});
test('UTF-8 lines stay within 75 octets and unfold without splitting Hebrew or emoji', () => {
  const text = `SUMMARY:${'עברית😀,;\\'.repeat(30)}`;
  const folded = foldCalendarLine(text);
  for (const line of folded.split('\r\n')) { assert.ok(Buffer.byteLength(line) <= 75); assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(line)), line); }
  assert.equal(folded.replace(/\r\n[ \t]/g, ''), text);
});
test('text escaping prevents forged properties for CR, LF and CRLF, including UID injection', () => {
  assert.equal(escapeCalendarText('a\r\nb\rc\nd,;\\'), 'a\\nb\\nc\\nd\\,\\;\\\\');
  const body = bookingCalendarBody({ ...booking, id: 'x\r\nATTENDEE:evil', service: { name: 'Visit\r\nATTENDEE:evil,;\\' } });
  assert.equal(body.split('\r\n').some(line => line.startsWith('ATTENDEE:')), false);
  assert.match(body, /UID:x%0D%0AATTENDEE%3Aevil@visit.app/);
  assert.equal(body.endsWith('\r\n'), true);
});
test('invalid interval, date and revision cannot produce a calendar artifact', () => {
  for (const invalid of [{ ...booking, endsAt: booking.startsAt }, { ...booking, startsAt: 'bad' }, { ...booking, revision: -1 }, { ...booking, revision: 0.5 }, { ...booking, updatedAt: '' }, { ...booking, id: '' }]) assert.throws(() => bookingCalendarBody(invalid), RangeError);
});

test('folding respects exact ASCII and multibyte octet boundaries, including continuation space', () => {
  for (const text of ['', 'a'.repeat(75), 'a'.repeat(76), `${'a'.repeat(74)}😀`, `${'א'.repeat(37)}😀`, '😀'.repeat(100)]) {
    const lines = foldCalendarLine(text).split('\r\n');
    assert.equal(lines.map((line, index) => index ? line.slice(1) : line).join(''), text);
    for (const [index, line] of lines.entries()) {
      assert.ok(Buffer.byteLength(line) <= 75);
      if (index) assert.ok(line.startsWith(' '));
    }
  }
});

test('calendar escapes all untrusted text fields and strips disallowed control bytes', () => {
  const text = 'שם😀\u0000\u0007\u000b\u001f\u007f\r\nEND:VEVENT\nBEGIN:VEVENT,;\\';
  const body = bookingCalendarBody({ ...booking, business: { name: text, timezone: text }, staff: { displayName: text }, service: { name: text } });
  const unfolded = body.replace(/\r\n[ \t]/g, '');
  assert.equal(body.split('\r\n').filter(line => line === 'BEGIN:VEVENT').length, 1);
  assert.equal(body.split('\r\n').filter(line => line === 'END:VEVENT').length, 1);
  assert.equal(/[\u0000\u0007\u000b\u001f\u007f]/.test(body), false);
  assert.ok(unfolded.includes('שם😀\\nEND:VEVENT\\nBEGIN:VEVENT\\,\\;\\\\'));
});

test('calendar rejects nonfinite revisions, unsafe integers and out-of-range calendar years', () => {
  for (const revision of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => bookingCalendarBody({ ...booking, revision }), RangeError);
  for (const updatedAt of ['invalid', '0000-01-01T00:00:00Z', '+010000-01-01T00:00:00Z']) assert.throws(() => bookingCalendarBody({ ...booking, updatedAt }), RangeError);
  const offset = bookingCalendarBody({ ...booking, startsAt: '2026-10-25T01:30:00+02:00', endsAt: '2026-10-25T02:00:00+02:00' });
  assert.match(offset, /DTSTART:20261024T233000Z/);
  assert.match(offset, /DTEND:20261025T000000Z/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAuthReturnTo } from '@visit/contracts';
import { bookingCommitToastKey, parseBookingDetailsId, showsScheduledNotes, showsStatus } from '../src/lib/BookingDetails.utils';
import type { BookingDetails } from '../src/types/BookingDetails.types';

const booking: BookingDetails = {
  id: 'booking-123', status: 'CONFIRMED', revision: 0,
  startsAt: '2026-10-27T08:00:00Z', endsAt: '2026-10-27T08:30:00Z',
  service: { id: 'service', name: 'Consultation', durationMinutes: 30, priceMinor: null, currency: null },
  business: { id: 'business', name: 'Studio', timezone: 'Asia/Jerusalem', location: null },
  staff: { displayName: 'Alex' }, cancellationCutoffMinutes: 0,
  actions: { canExport: true, canCancel: true, canReschedule: true },
  notification: { status: 'LEGACY', recordedAt: null, sms: 'UNSUPPORTED', whatsapp: 'UNSUPPORTED' },
};

test('details IDs accept exact bounded route tokens and reject nullable, duplicate and encoded paths', () => {
  for (const id of ['a', 'A_0-z', 'x'.repeat(128)]) assert.equal(parseBookingDetailsId(id), id);
  for (const value of [undefined, null, '', 0, {}, [], ['booking'], ['a', 'b'], 'x'.repeat(129), 'a/b', 'a?b', 'a#b', 'a%2Fb', '..', ' a', 'a\n', 'עברית']) {
    assert.equal(parseBookingDetailsId(value), undefined);
  }
});

test('authentication returns preserve only exact appointment destinations', () => {
  for (const prefix of ['/confirmation/', '/appointment/']) {
    for (const id of ['a', 'A_0-z', 'x'.repeat(128)]) {
      const path = `${prefix}${id}`;
      assert.equal(safeAuthReturnTo(path), path);
    }
    for (const suffix of ['', 'a/b', '..', '%2e%2e', 'a?revision=1', 'a#grant=x', 'x'.repeat(129), 'a%2Fb', 'a\\b', 'a\r\n']) {
      assert.equal(safeAuthReturnTo(`${prefix}${suffix}`), undefined);
    }
  }
  assert.equal(safeAuthReturnTo('/appointments'), '/appointments');
  for (const path of ['/appointments/', '/appointments?customerId=x', '//evil.test/appointments', 'https://evil.test/appointment/a']) assert.equal(safeAuthReturnTo(path), undefined);
});

test('a commit toast says which change was saved', () => {
  assert.equal(bookingCommitToastKey(false), 'details.confirmed');
  assert.equal(bookingCommitToastKey(true), 'details.rescheduledNote');
});

test('cutoff and confirmation-message notes show only while the appointment is scheduled', () => {
  assert.equal(showsScheduledNotes(booking), true);
  for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) assert.equal(showsScheduledNotes({ status }), false);
});

test('a scheduled appointment hides its status line and an ended one keeps it', () => {
  assert.equal(showsStatus(booking), false);
  for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) assert.equal(showsStatus({ status }), true);
});

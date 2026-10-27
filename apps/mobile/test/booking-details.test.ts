import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAuthReturnTo } from '@visit/contracts';
import { hasConfirmedBooking, parseBookingDetailsId } from '../src/lib/BookingDetails.utils';
import type { BookingDetails } from '../src/types/BookingDetails.types';

const booking: BookingDetails = {
  id: 'booking-123', status: 'CONFIRMED', revision: 0,
  startsAt: '2026-10-27T08:00:00Z', endsAt: '2026-10-27T08:30:00Z',
  service: { id: 'service', name: 'Consultation', durationMinutes: 30, priceMinor: null, currency: null },
  business: { id: 'business', name: 'Studio', timezone: 'Asia/Jerusalem' },
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

test('success requires a fresh confirmed persisted booking, including legacy records', () => {
  assert.equal(hasConfirmedBooking(undefined, true), false);
  assert.equal(hasConfirmedBooking(undefined, false), false);
  assert.equal(hasConfirmedBooking(booking, true), true);
  assert.equal(hasConfirmedBooking(booking, false), false);
  for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) {
    assert.equal(hasConfirmedBooking({ ...booking, status }, true), false);
    assert.equal(hasConfirmedBooking({ ...booking, status }, false), false);
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

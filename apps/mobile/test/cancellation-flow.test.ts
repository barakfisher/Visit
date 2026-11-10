import assert from 'node:assert/strict';
import test from 'node:test';
import { translate, type Locale } from '../src/i18n/messages';
import { appointmentCancellationCopy } from '../src/i18n/cancellationConfirm';
import { MINUTES_PER_HOUR } from '../src/i18n/cancellationCutoff';
import { appointmentCancelFailureKey, appointmentLockedKey, bookingWindowWarningKey, CANCELLATION_CUTOFF, RESCHEDULE_CUTOFF } from '../src/lib/AppointmentLifecycle.utils';

const locales: Locale[] = ['he', 'en'];
const MINUTE_MS = 60000, DAY_MINUTES = 24 * MINUTES_PER_HOUR;

test('the cancel confirmation speaks the screen language', () => {
  for (const locale of locales) {
    const copy = appointmentCancellationCopy(locale);
    assert.deepEqual(copy, { title: translate(locale, 'upcoming.cancelTitle'), message: translate(locale, 'upcoming.cancelMessage'), keep: translate(locale, 'upcoming.keep'), cancel: translate(locale, 'details.cancel') });
  }
  assert.notDeepEqual(appointmentCancellationCopy('he'), appointmentCancellationCopy('en'));
});

test('an Appointments cancel failure says why for a cutoff and falls back to the general failure otherwise', () => {
  assert.equal(appointmentCancelFailureKey(CANCELLATION_CUTOFF), 'lifecycle.cancelCutoff');
  assert.equal(appointmentCancelFailureKey(RESCHEDULE_CUTOFF), 'lifecycle.rescheduleCutoff');
  for (const code of [undefined, 'CONFLICT', 'BOOKING_REVISION_MISMATCH']) assert.equal(appointmentCancelFailureKey(code), 'lifecycle.failure');
});

test('a card without an allowed change says which one is no longer possible', () => {
  assert.equal(appointmentLockedKey({ canCancel: true, canReschedule: true }), null);
  assert.equal(appointmentLockedKey({ canCancel: false, canReschedule: false }), 'lifecycle.lockedBoth');
  assert.equal(appointmentLockedKey({ canCancel: false, canReschedule: true }), 'lifecycle.lockedCancel');
  assert.equal(appointmentLockedKey({ canCancel: true, canReschedule: false }), 'lifecycle.lockedReschedule');
  for (const key of ['lifecycle.lockedBoth', 'lifecycle.lockedCancel', 'lifecycle.lockedReschedule'] as const) assert.notEqual(translate('he', key), translate('en', key));
});

test('the review warns when the chosen time is already inside the change window', () => {
  const now = Date.parse('2026-11-02T20:30:00Z'), at = (minutesAhead: number) => new Date(now + minutesAhead * MINUTE_MS).toISOString();
  const policy = { cancellationCutoffMinutes: DAY_MINUTES, rescheduleCutoffMinutes: DAY_MINUTES };
  // The manual-run case: at 22:30 Israel time, booking 10:00 the next morning with a 24-hour window.
  assert.equal(bookingWindowWarningKey('2026-11-03T08:00:00Z', now, policy), 'bookingCommit.insideBoth');
  assert.equal(bookingWindowWarningKey(at(DAY_MINUTES - 1), now, policy), 'bookingCommit.insideBoth');
  assert.equal(bookingWindowWarningKey(at(DAY_MINUTES), now, policy), null, 'the cutoff itself is still allowed, as on the server');
  assert.equal(bookingWindowWarningKey(at(DAY_MINUTES - 1), now, { ...policy, rescheduleCutoffMinutes: 0 }), 'bookingCommit.insideCancel');
  assert.equal(bookingWindowWarningKey(at(DAY_MINUTES - 1), now, { ...policy, cancellationCutoffMinutes: 0 }), 'bookingCommit.insideReschedule');
  assert.equal(bookingWindowWarningKey(at(1), now, { cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 }), null);
  for (const missing of [null, undefined]) assert.equal(bookingWindowWarningKey(at(1), now, missing), null);
  assert.equal(bookingWindowWarningKey('not-a-date', now, policy), null);
  for (const key of ['bookingCommit.insideBoth', 'bookingCommit.insideCancel', 'bookingCommit.insideReschedule'] as const) assert.notEqual(translate('he', key), translate('en', key));
});

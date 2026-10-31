import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentOutcomeDelay, appointmentRefusalKey, bookingLoadRefusalKey, canContinueAppointmentAction, canRecordAppointmentOutcome, CANCELLATION_CUTOFF, RESCHEDULE_CUTOFF } from '../src/lib/AppointmentLifecycle.utils';
import { translate } from '../src/i18n/messages';
import type { AppointmentActionScope, LifecycleAppointment } from '../src/types/AppointmentLifecycle.types';
const booking: LifecycleAppointment = { id: 'booking', status: 'CONFIRMED', revision: 0, startsAt: '2026-10-26T07:00:00Z', endsAt: '2026-10-26T07:30:00Z' };
test('outcome controls require a scheduled appointment that has ended at the exact absolute instant', () => {
  const end = Date.parse(booking.endsAt);
  assert.equal(canRecordAppointmentOutcome(booking, end - 1), false);
  assert.equal(canRecordAppointmentOutcome(booking, end), true);
  assert.equal(canRecordAppointmentOutcome(booking, end + 1), true);
  for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) assert.equal(canRecordAppointmentOutcome({ ...booking, status }, end + 1), false);
});
test('invalid appointment or clock boundaries never expose outcome actions', () => {
  assert.equal(canRecordAppointmentOutcome({ ...booking, endsAt: '' }), false);
  assert.equal(canRecordAppointmentOutcome({ ...booking, endsAt: 'invalid' }), false);
  assert.equal(canRecordAppointmentOutcome(booking, Number.NaN), false);
  assert.equal(canRecordAppointmentOutcome(booking, Number.POSITIVE_INFINITY), false);
});
test('outcome eligibility compares instants across offsets and leaves input unchanged', () => {
  const offsetBooking = { ...booking, endsAt: '2026-10-26T09:30:00+02:00' };
  const original = { ...offsetBooking };
  assert.equal(canRecordAppointmentOutcome(offsetBooking, Date.parse('2026-10-26T07:29:59.999Z')), false);
  assert.equal(canRecordAppointmentOutcome(offsetBooking, Date.parse('2026-10-26T07:30:00Z')), true);
  assert.deepEqual(offsetBooking, original);
});
test('terminal statuses remain ineligible with invalid, future, and already-ended times', () => {
  for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) {
    for (const endsAt of ['', 'invalid', '2026-10-26T07:30:00Z', '2027-01-01T00:00:00Z']) {
      assert.equal(canRecordAppointmentOutcome({ ...booking, status, endsAt }, Date.parse('2026-10-27T00:00:00Z')), false);
    }
  }
});

test('outcome timer handles end boundaries, invalid clocks, and platform timeout overflow', () => {
  const end = Date.parse(booking.endsAt);
  assert.equal(appointmentOutcomeDelay(booking.endsAt, end - 1), 2);
  assert.equal(appointmentOutcomeDelay(booking.endsAt, end), null);
  assert.equal(appointmentOutcomeDelay(booking.endsAt, end + 1), null);
  assert.equal(appointmentOutcomeDelay(booking.endsAt, end - 2147483646), 2147483647);
  assert.equal(appointmentOutcomeDelay(booking.endsAt, end - 2147483647), 2147483647);
  assert.equal(appointmentOutcomeDelay(booking.endsAt, end - 86400000000), 2147483647);
  for (const invalid of ['', 'invalid']) assert.equal(appointmentOutcomeDelay(invalid, end), null);
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(appointmentOutcomeDelay(booking.endsAt, invalid), null);
});

test('deferred confirmation checks the latest identity, context, business, and mount scope', async () => {
  const initial: AppointmentActionScope = { identityId: 'customer-a', contextVersion: 4, activeBusinessId: 'business-a' };
  const cases: { current: AppointmentActionScope; mounted: boolean; allowed: boolean }[] = [
    { current: { ...initial }, mounted: true, allowed: true },
    { current: { ...initial, identityId: 'customer-b' }, mounted: true, allowed: false },
    { current: { ...initial, identityId: null }, mounted: true, allowed: false },
    { current: { ...initial, contextVersion: 5 }, mounted: true, allowed: false },
    { current: { ...initial, activeBusinessId: 'business-b' }, mounted: true, allowed: false },
    { current: { ...initial, activeBusinessId: null }, mounted: true, allowed: false },
    { current: { ...initial }, mounted: false, allowed: false },
  ];
  for (const businessId of [undefined, 'business-a']) {
    for (const scenario of cases) {
      let finish: (() => void) | undefined;
      const confirmation = new Promise<void>(resolve => { finish = resolve; });
      let current = initial;
      let mounted = true;
      const continuation = confirmation.then(() => canContinueAppointmentAction(initial, current, mounted, businessId));
      current = scenario.current;
      mounted = scenario.mounted;
      assert.ok(finish);
      finish();
      assert.equal(await continuation, scenario.allowed);
    }
  }
  assert.equal(canContinueAppointmentAction(initial, initial, true, 'business-b'), false);
  const anonymous = { ...initial, identityId: null };
  assert.equal(canContinueAppointmentAction(anonymous, anonymous, true), false);
  const customerScope = { ...initial, activeBusinessId: null };
  assert.equal(canContinueAppointmentAction(customerScope, customerScope, true), true);
});
test('cutoff refusals map to their own localized copy; other refusals keep the caller fallback', () => {
  assert.equal(appointmentRefusalKey(CANCELLATION_CUTOFF), 'lifecycle.cancelCutoff');
  assert.equal(appointmentRefusalKey(RESCHEDULE_CUTOFF), 'lifecycle.rescheduleCutoff');
  for (const code of ['CONFLICT', 'CUSTOMER_CONTACT_REQUIRED', undefined]) assert.equal(appointmentRefusalKey(code), null);
  // A booking screen that cannot load keeps a cutoff's reason, treats not-found and unpublished alike, and never falls back to the server's text.
  assert.equal(bookingLoadRefusalKey(RESCHEDULE_CUTOFF, 409), 'lifecycle.rescheduleCutoff');
  assert.equal(bookingLoadRefusalKey('NOT_FOUND', 404), 'providers.unavailable');
  for (const [code, status] of [['CONFLICT', 409], [undefined, undefined]] as const) assert.equal(bookingLoadRefusalKey(code, status), 'compact.detailsFailed');
  // translate falls back to English and then to the key, so Hebrew copy must differ from English to exist.
  for (const key of ['lifecycle.cancelCutoff', 'lifecycle.rescheduleCutoff', 'compact.detailsFailed'] as const) { assert.notEqual(translate('en', key), key); assert.notEqual(translate('he', key), translate('en', key)); }
});

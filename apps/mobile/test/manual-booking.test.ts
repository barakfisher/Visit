import assert from 'node:assert/strict';
import test from 'node:test';
import { manualDraftScope, manualInput } from '../src/lib/ManualBooking.utils';
import { openManualBooking } from '../src/lib/ManualBookingEntry';
import { useSessionStore } from '../src/state/session';
import { emptyManualDraft, useManualDraft } from '../src/state/ManualBooking.store';
import type { ManualDraft, ManualOptions } from '../src/types/ManualBooking.types';
const options: ManualOptions = { timezone: 'Asia/Jerusalem', bookable: true, services: [{ id: 'service', name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS', staff: [{ id: 'staff', displayName: 'Specialist', parallelCapacity: 1 }] }] };
const draft: ManualDraft = { ...emptyManualDraft, open: true, serviceId: 'service', staffId: 'staff', localDate: '2027-03-15', localTime: '12:00', customerName: ' New customer ', customerPhone: ' +972501234567 ' };
test('manual input captures reviewed service and trims contact without inventing verification', () => {
 const before = structuredClone(draft), result = manualInput(draft, options, 'attempt');
 assert.ok(result); assert.equal(result.customerName, 'New customer'); assert.equal(result.customerPhone, '+972501234567');
 assert.equal('exceptionReason' in result, false); assert.equal(result.finalConsent, true); assert.equal(result.idempotencyKey, 'attempt');
 assert.deepEqual(result.reviewedService, { name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' });
 assert.equal('customerId' in result, false); assert.equal('customerPhoneVerifiedAt' in result, false); assert.equal('customerEmail' in result, false); assert.deepEqual(draft, before);
});
test('a phone typed the Israeli way is sent in E.164', () => {
 assert.equal(manualInput({ ...draft, customerPhone: '050-123 4567' }, options, 'attempt')?.customerPhone, '+972501234567');
});
test('manual validation rejects missing options, assignments and malformed boundaries', () => {
 assert.equal(manualInput(draft, undefined, 'attempt'), null);
 for (const changed of [{ ...options, bookable: false }, { ...options, services: [] }]) assert.equal(manualInput(draft, changed, 'attempt'), null);
 const invalid: Partial<ManualDraft>[] = [{ serviceId: '' }, { staffId: 'foreign' }, { localDate: '2027-02-30' }, { localTime: '24:00' }, { localTime: '12:60' }, { customerName: ' ' }, { customerName: 'a'.repeat(121) }, { customerPhone: '12345' }, { customerPhone: '+123' }, { customerEmail: 'broken' }, { utcOffset: 'Israel' }];
 for (const patch of invalid) assert.equal(manualInput({ ...draft, ...patch }, options, 'attempt'), null, JSON.stringify(patch));
});
test('manual store retains the same uncertain attempt, ignores stale results and clears private data', () => {
 const store = useManualDraft;
 store.getState().clear(); store.getState().update('a', draft);
 const input = manualInput(draft, options, 'same-attempt'); assert.ok(input);
 store.getState().prepare('a', input); assert.equal(store.getState().draft.reviewed, true);
 store.getState().begin('a', input); store.getState().update('a', { customerName: 'Changed' });
 assert.equal(store.getState().attempt?.idempotencyKey, 'same-attempt'); assert.equal(store.getState().draft.customerName, draft.customerName);
 store.getState().unlock('stale'); assert.ok(store.getState().attempt);
 store.getState().update('b', { open: true }); assert.deepEqual(store.getState().draft, { ...emptyManualDraft, open: true }); assert.equal(store.getState().attempt, null);
 const result = { id: 'booking', status: 'CONFIRMED', startsAt: '', endsAt: '', revision: 0, source: 'MANUAL' as const, contactVerification: 'UNVERIFIED' as const, notification: 'NOT_SENT' as const };
 store.getState().finish('a', result); assert.equal(store.getState().result, null);
 store.getState().finish('b', result); assert.deepEqual(store.getState().result, result);
 store.getState().clear(); assert.equal(store.getState().scope, ''); assert.deepEqual(store.getState().draft, emptyManualDraft); assert.equal(store.getState().result, null);
});
test('Add appointment starts a new form today and leaves a form in progress alone', () => {
 const business = { id: 'business', name: 'Clinic', timezone: 'Asia/Jerusalem', role: 'OWNER' as const };
 useSessionStore.getState().clear(); useManualDraft.getState().clear();
 try {
  useSessionStore.getState().setAuth('token', { id: 'manager', email: null, phone: null, is_provider: true, businesses: [business] });
  openManualBooking(business.id);
  const { identityId, contextVersion } = useSessionStore.getState(), scope = manualDraftScope(identityId, contextVersion, business.id);
  // An empty day is today in the business's timezone, filled in by the form.
  assert.equal(useManualDraft.getState().scope, scope); assert.equal(useManualDraft.getState().draft.open, true); assert.equal(useManualDraft.getState().draft.localDate, emptyManualDraft.localDate);
  const chosen = '2027-03-20';
  useManualDraft.getState().update(scope, { customerName: 'Caller', localDate: chosen });
  openManualBooking(business.id);
  assert.equal(useManualDraft.getState().draft.customerName, 'Caller'); assert.equal(useManualDraft.getState().draft.localDate, chosen);
  useManualDraft.getState().finish(scope, { id: 'saved', status: 'CONFIRMED', startsAt: '', endsAt: '', revision: 1, source: 'MANUAL', contactVerification: 'UNVERIFIED', notification: 'NOT_SENT' });
  openManualBooking(business.id);
  assert.equal(useManualDraft.getState().result, null); assert.equal(useManualDraft.getState().draft.customerName, emptyManualDraft.customerName); assert.equal(useManualDraft.getState().draft.localDate, emptyManualDraft.localDate);
  openManualBooking('foreign-business'); assert.equal(useManualDraft.getState().scope, scope);
  // A free card names its day, time and staff member.
  const free = { localDate: chosen, localTime: '10:45', staffId: 'staff' };
  openManualBooking(business.id, free);
  assert.deepEqual({ localDate: useManualDraft.getState().draft.localDate, localTime: useManualDraft.getState().draft.localTime, staffId: useManualDraft.getState().draft.staffId }, free);
 } finally { useSessionStore.getState().clear(); useManualDraft.getState().clear(); }
});
test('a typed customer is saved by default, and saving can be turned off (criteria 3, 4)', () => {
 assert.equal(manualInput(draft, options, 'attempt')?.saveCustomer, true);
 assert.equal(emptyManualDraft.saveCustomer, true);
 const off = manualInput({ ...draft, saveCustomer: false }, options, 'attempt');
 assert.equal(off?.saveCustomer, false); assert.equal(off && 'customerCardId' in off, false);
});
test('a picked card books on that card with its own contacts; typing fills only what it lacks (criterion 2)', () => {
 const card = { id: 'card', name: 'Dana Levi', phone: '+972501234567', email: 'dana@example.test', linked: false };
 const picked = manualInput({ ...draft, customerCard: card, customerName: 'Typed', customerPhone: '', customerEmail: 'typed@example.test' }, options, 'attempt');
 assert.ok(picked); assert.equal(picked.customerCardId, 'card'); assert.equal('saveCustomer' in picked, false);
 assert.equal(picked.customerName, 'Dana Levi'); assert.equal(picked.customerPhone, '+972501234567'); assert.equal(picked.customerEmail, 'dana@example.test');
 const app = { id: 'app', name: null, phone: null, email: 'app@example.test', linked: true };
 const filled = manualInput({ ...draft, customerCard: app, customerName: 'Typed Name', customerPhone: '050-7654321' }, options, 'attempt');
 assert.equal(filled?.customerName, 'Typed Name'); assert.equal(filled?.customerPhone, '+972507654321'); assert.equal(filled?.customerEmail, 'app@example.test');
 assert.equal(manualInput({ ...draft, customerCard: app, customerPhone: '' }, options, 'attempt'), null);
});

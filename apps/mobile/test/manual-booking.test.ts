import assert from 'node:assert/strict';
import test from 'node:test';
import { manualDraftScope, manualInput } from '../src/lib/ManualBooking.utils';
import { openManualBooking } from '../src/lib/ManualBookingEntry';
import { useSessionStore } from '../src/state/session';
import { emptyManualDraft, useManualDraft } from '../src/state/ManualBooking.store';
import type { ManualDraft, ManualOptions } from '../src/types/ManualBooking.types';
const options: ManualOptions = { timezone: 'Asia/Jerusalem', bookable: true, requiresException: true, services: [{ id: 'service', name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS', staff: [{ id: 'staff', displayName: 'Specialist', parallelCapacity: 1 }] }] };
const draft: ManualDraft = { ...emptyManualDraft, open: true, serviceId: 'service', staffId: 'staff', localDate: '2027-03-15', localTime: '12:00', customerName: ' New customer ', customerPhone: ' +972501234567 ', exceptionReason: ' Phone appointment ' };
test('manual input captures reviewed service and trims contact without inventing verification', () => {
 const before = structuredClone(draft), result = manualInput(draft, options, 'attempt');
 assert.ok(result); assert.equal(result.customerName, 'New customer'); assert.equal(result.customerPhone, '+972501234567');
 assert.equal(result.exceptionReason, 'Phone appointment'); assert.equal(result.finalConsent, true); assert.equal(result.idempotencyKey, 'attempt');
 assert.deepEqual(result.reviewedService, { name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' });
 assert.equal('customerId' in result, false); assert.equal('customerPhoneVerifiedAt' in result, false); assert.equal('customerEmail' in result, false); assert.deepEqual(draft, before);
});
test('manual validation rejects missing options, assignments, malformed boundaries and absent exceptions', () => {
 assert.equal(manualInput(draft, undefined, 'attempt'), null);
 for (const changed of [{ ...options, bookable: false }, { ...options, services: [] }]) assert.equal(manualInput(draft, changed, 'attempt'), null);
 const invalid: Partial<ManualDraft>[] = [{ serviceId: '' }, { staffId: 'foreign' }, { localDate: '2027-02-30' }, { localTime: '24:00' }, { localTime: '12:60' }, { customerName: ' ' }, { customerName: 'a'.repeat(121) }, { customerPhone: '0501234567' }, { customerPhone: '+123' }, { customerEmail: 'broken' }, { utcOffset: 'Israel' }, { exceptionReason: ' ' }, { exceptionReason: 'a'.repeat(501) }];
 for (const patch of invalid) assert.equal(manualInput({ ...draft, ...patch }, options, 'attempt'), null, JSON.stringify(patch));
 assert.ok(manualInput({ ...draft, exceptionReason: '' }, { ...options, requiresException: false }, 'attempt'));
 assert.equal(manualInput({ ...draft, exceptionReason: 'abc' }, { ...options, requiresException: false }, 'attempt'), null);
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
test('Add appointment starts a new form on the day it is given and leaves a form in progress alone', () => {
 const business = { id: 'business', name: 'Clinic', timezone: 'Asia/Jerusalem', role: 'OWNER' as const };
 useSessionStore.getState().clear(); useManualDraft.getState().clear();
 try {
  useSessionStore.getState().setAuth('token', { id: 'manager', email: null, phone: null, is_provider: true, businesses: [business] });
  const day = '2027-03-15', later = '2027-03-20';
  openManualBooking(business.id, day);
  const { identityId, contextVersion } = useSessionStore.getState(), scope = manualDraftScope(identityId, contextVersion, business.id);
  assert.equal(useManualDraft.getState().scope, scope); assert.equal(useManualDraft.getState().draft.open, true); assert.equal(useManualDraft.getState().draft.localDate, day);
  useManualDraft.getState().update(scope, { customerName: 'Caller' });
  openManualBooking(business.id, later);
  assert.equal(useManualDraft.getState().draft.customerName, 'Caller'); assert.equal(useManualDraft.getState().draft.localDate, day);
  useManualDraft.getState().finish(scope, { id: 'saved', status: 'CONFIRMED', startsAt: '', endsAt: '', revision: 1, source: 'MANUAL', contactVerification: 'UNVERIFIED', notification: 'NOT_SENT' });
  openManualBooking(business.id, later);
  assert.equal(useManualDraft.getState().result, null); assert.equal(useManualDraft.getState().draft.customerName, ''); assert.equal(useManualDraft.getState().draft.localDate, later);
  openManualBooking('foreign-business', day); assert.equal(useManualDraft.getState().scope, scope);
 } finally { useSessionStore.getState().clear(); useManualDraft.getState().clear(); }
});

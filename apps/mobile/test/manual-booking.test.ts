import assert from 'node:assert/strict';
import test from 'node:test';
import { manualInput } from '../src/lib/ManualBooking.utils';
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

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { useBookingContactDraft } from '../src/state/BookingContactDraft.store';
import type { BookingContactDraft } from '../src/types/BookingContact.types';

const draft: BookingContactDraft = {
  identityId: 'customer-a', providerId: 'provider-a', serviceId: 'service-a', date: '2026-11-01',
  selected: { startsAt: '2026-11-01T07:00:00.000Z', localTime: '09:00', utcOffset: '+02:00', staffId: 'staff-a', staffName: 'Staff A', available: true, locked: false },
};
afterEach(() => useBookingContactDraft.getState().clear());

test('reauthentication draft retains exact appointment instant and accepts no selected slot', () => {
  useBookingContactDraft.getState().save(draft);
  assert.deepEqual(useBookingContactDraft.getState().draft, draft);
  useBookingContactDraft.getState().save({ ...draft, selected: null });
  assert.equal(useBookingContactDraft.getState().draft?.selected, null);
});

test('a later customer or provider draft replaces all previous advisory choices', () => {
  useBookingContactDraft.getState().save(draft);
  const replacement = { identityId: 'customer-b', providerId: 'provider-b', serviceId: '', date: '', selected: null };
  useBookingContactDraft.getState().save(replacement);
  assert.deepEqual(useBookingContactDraft.getState().draft, replacement);
});

test('consumed draft is cleared completely and repeated cleanup is safe', () => {
  useBookingContactDraft.getState().save(draft);
  useBookingContactDraft.getState().clear();
  useBookingContactDraft.getState().clear();
  assert.equal(useBookingContactDraft.getState().draft, null);
});

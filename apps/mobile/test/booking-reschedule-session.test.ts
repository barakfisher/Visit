import assert from 'node:assert/strict';
import test from 'node:test';
import { useRescheduleAttempt } from '../src/state/BookingReschedule.store';
import { useSessionStore } from '../src/state/session';
import type { RescheduleAttempt } from '../src/types/BookingReschedule.types';

const profile = { id: 'reschedule-customer', email: null, phone: null, is_provider: false, businesses: [] };
const attempt: RescheduleAttempt = {
  identityId: profile.id, providerId: 'business', serviceId: 'service', staffId: 'staff', bookingId: 'booking', expectedRevision: 3,
  startsAt: '2026-11-01T08:00:00Z', idempotencyKey: 'reschedule-retry-key',
  reviewedService: { name: 'Snapshot', durationMinutes: 30, priceMinor: null, currency: null },
};

test('same-account token rotation preserves the exact reschedule retry identity', () => {
  useSessionStore.getState().clear();
  try {
    useSessionStore.getState().setAuth('before', profile);
    useRescheduleAttempt.getState().set(attempt);
    useSessionStore.getState().setAuth('after', { ...profile, email: 'verified@example.test' });
    assert.deepEqual(useRescheduleAttempt.getState().attempt, attempt);
    useSessionStore.getState().resetAuthContext('reset', profile);
    assert.deepEqual(useRescheduleAttempt.getState().attempt, attempt);
  } finally { useSessionStore.getState().clear(); }
});

test('logout, account replacement and direct identity replacement remove private reschedule consent', () => {
  for (const transition of ['logout', 'account', 'identity'] as const) {
    useSessionStore.getState().clear();
    try {
      useSessionStore.getState().setAuth('token', profile);
      useRescheduleAttempt.getState().set(attempt);
      if (transition === 'logout') useSessionStore.getState().clear();
      else if (transition === 'account') useSessionStore.getState().setAuth('other-token', { ...profile, id: 'other-customer' });
      else useSessionStore.getState().setIdentity('other-customer');
      assert.equal(useRescheduleAttempt.getState().attempt, null, transition);
    } finally { useSessionStore.getState().clear(); }
  }
});

test('restoring a different account discards a stale attempt even before a profile is loaded', () => {
  useSessionStore.getState().clear();
  try {
    useRescheduleAttempt.getState().set(attempt);
    useSessionStore.getState().setAuth('other-token', { ...profile, id: 'other-customer' });
    assert.equal(useRescheduleAttempt.getState().attempt, null);
  } finally { useSessionStore.getState().clear(); }
});

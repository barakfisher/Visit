import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/http/errors.js';
import { assertCustomerContact, customerContactReadiness } from '../src/security/customer-contact.utils.js';
import { DEFAULT_BOOKING_POLICY, parseBookingPolicy } from '../src/scheduling/rules.js';

const verifiedAt = new Date('2026-10-26T08:00:00.000Z');
const emptyProfile = { displayName: null, phone: null, phoneVerifiedAt: null, email: null, emailVerifiedAt: null };

for (let mask = 0; mask < 8; mask++) {
  test(`contact readiness evaluates independent requirement combination ${mask}`, () => {
    const policy = { requireCustomerName: Boolean(mask & 1), requireVerifiedPhone: Boolean(mask & 2), requireVerifiedEmail: Boolean(mask & 4) };
    const expected = [...(policy.requireCustomerName ? ['name'] : []), ...(policy.requireVerifiedPhone ? ['phone'] : []), ...(policy.requireVerifiedEmail ? ['email'] : [])];
    assert.deepEqual(customerContactReadiness(policy, emptyProfile), { requirements: policy, missing: expected, ready: mask === 0 });
    const complete = { displayName: 'אב', phone: '+972501234567', phoneVerifiedAt: verifiedAt, email: 'a@example.test', emailVerifiedAt: verifiedAt };
    assert.equal(customerContactReadiness(policy, complete).ready, true);
    assert.doesNotThrow(() => assertCustomerContact(policy, complete));
  });
}

test('name readiness trims whitespace and accepts the minimum two-character name', () => {
  const policy = { requireCustomerName: true, requireVerifiedPhone: false, requireVerifiedEmail: false };
  for (const displayName of [null, '', '  ', ' א ']) {
    assert.deepEqual(customerContactReadiness(policy, { ...emptyProfile, displayName }).missing, ['name']);
  }
  assert.equal(customerContactReadiness(policy, { ...emptyProfile, displayName: ' אב ' }).ready, true);
});

test('contact values and their verification timestamps are both required', () => {
  const policy = { requireCustomerName: false, requireVerifiedPhone: true, requireVerifiedEmail: true };
  for (const profile of [
    { ...emptyProfile, phoneVerifiedAt: verifiedAt, emailVerifiedAt: verifiedAt },
    { ...emptyProfile, phone: '', email: '', phoneVerifiedAt: verifiedAt, emailVerifiedAt: verifiedAt },
    { ...emptyProfile, phone: '+972501234567', email: 'a@example.test' },
  ]) {
    assert.deepEqual(customerContactReadiness(policy, profile).missing, ['phone', 'email']);
    assert.throws(() => assertCustomerContact(policy, profile), (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === 'CUSTOMER_CONTACT_REQUIRED');
  }
});

test('readiness never mutates inputs or aliases returned requirement flags', () => {
  const policy = Object.freeze({ requireCustomerName: false, requireVerifiedPhone: false, requireVerifiedEmail: false });
  const profile = Object.freeze({ ...emptyProfile });
  const result = customerContactReadiness(policy, profile);
  result.requirements.requireVerifiedPhone = true;
  result.missing.push('phone');
  assert.deepEqual(customerContactReadiness(policy, profile), { requirements: policy, missing: [], ready: true });
});

test('legacy policy omission remains absent while explicit false and true remain explicit', () => {
  const legacy = parseBookingPolicy(DEFAULT_BOOKING_POLICY);
  assert.equal(Object.hasOwn(legacy, 'requireVerifiedPhone'), false);
  const policy = parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, requireCustomerName: false, requireVerifiedPhone: true, requireVerifiedEmail: false });
  assert.equal(policy.requireCustomerName, false);
  assert.equal(policy.requireVerifiedPhone, true);
  assert.equal(policy.requireVerifiedEmail, false);
});

test('policy rejects nullable and coerced requirement flags and forged contact assertions', () => {
  for (const key of ['requireCustomerName', 'requireVerifiedPhone', 'requireVerifiedEmail']) {
    for (const value of [null, '', 'true', 'false', 0, 1, [], {}]) {
      assert.throws(() => parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, [key]: value }));
    }
  }
  assert.throws(() => parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, phoneVerifiedAt: verifiedAt }));
});

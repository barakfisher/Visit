import assert from 'node:assert/strict';
import test from 'node:test';
import { accountBusiness, footerHidden, isProviderPath, manualBookingPath } from '../src/lib/navigation';

test('the footer leaves flows and signed-out screens alone', () => {
  for (const path of ['/auth/login', '/register/provider', '/invite']) assert.equal(footerHidden(path), true, path);
  for (const path of ['/', '/booking/abc', '/business/abc', '/appointments', '/appointment/abc', '/account', '/provider/dashboard', '/bookingish']) assert.equal(footerHidden(path), false, path);
});

test('provider mode is decided by the path', () => {
  assert.equal(isProviderPath('/provider/dashboard'), true);
  assert.equal(isProviderPath('/appointments'), false);
});

test('Add appointment is a business screen with the footer under it', () => {
  assert.equal(isProviderPath(manualBookingPath('business-1')), true);
  assert.equal(footerHidden(manualBookingPath('business-1')), false);
});

test('Account keeps the business it was opened from, only if it is the person\'s own', () => {
  const own = [{ id: 'business-1' }];
  assert.equal(accountBusiness('/account', 'business-1', own), 'business-1');
  for (const missing of [undefined, '', ['business-1', 'business-2'], 'foreign-business']) assert.equal(accountBusiness('/account', missing, own), null);
  assert.equal(accountBusiness('/account', 'business-1', undefined), null);
  assert.equal(accountBusiness('/appointments', 'business-1', own), null);
});

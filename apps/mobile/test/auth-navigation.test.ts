import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAuthReturnTo } from '@visit/contracts';
test('auth navigation accepts only canonical known non-secret internal destinations', () => {
  for (const value of ['/', '/register/provider', '/booking/business-123', '/booking/business-123?serviceId=service-1&date=2026-11-01&fromBookingId=booking-2']) assert.equal(safeAuthReturnTo(value), value);
  assert.equal(safeAuthReturnTo('/discover'), '/');
  for (const value of [undefined, ['/booking/a'], 'https://visit.invalid/booking/a', '//evil.test/booking/a', '/\\evil.test', '/x/../booking/a', '/booking/%2e%2e', '/booking/a#token=secret', '/booking/a?redirect=https://evil.test', '/booking/a?serviceId=a&serviceId=b', '/booking/a?date=2026-02-31', '/booking/a?date=bad', '/booking/a?serviceId=%2Fprovider', '/register/provider?role=ADMIN', '/provider/dashboard', '/discover?search=all', '/booking/a?token=private', '/booking/a?serviceId=a%0ab', '/booking/a?date=2026-11-01&unexpected=yes']) assert.equal(safeAuthReturnTo(value), undefined, JSON.stringify(value));
});

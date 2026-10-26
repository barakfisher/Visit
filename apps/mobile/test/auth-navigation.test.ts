import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAuthReturnTo } from '@visit/contracts';
test('auth navigation accepts only canonical known non-secret internal destinations', () => {
  for (const value of ['/', '/register/provider', '/provider/dashboard', '/provider/dashboard?businessId=allowed', '/provider/allowed', '/provider/team/allowed', '/p/clinic-a', '/booking/business-123', '/booking/business-123?serviceId=service-1&date=2026-11-01&fromBookingId=booking-2']) assert.equal(safeAuthReturnTo(value), value);
  assert.equal(safeAuthReturnTo('/discover'), '/');
  for (const value of [undefined, ['/booking/a'], 'https://visit.invalid/booking/a', '//evil.test/booking/a', '/\\evil.test', '/x/../booking/a', '/booking/%2e%2e', '/booking/a#token=secret', '/booking/a?redirect=https://evil.test', '/booking/a?serviceId=a&serviceId=b', '/booking/a?date=2026-02-31', '/booking/a?date=bad', '/booking/a?serviceId=%2Fprovider', '/register/provider?role=ADMIN', '/provider/dashboard?businessId=a&businessId=b', '/provider/dashboard?role=OWNER', '/provider/a?token=secret', '/provider/team/a?returnTo=/admin', '/p/a?role=OWNER', '/p/a#token=secret', '/p/../admin', '/p/a%2Fb', '/p/-bad', '/p/Bad', '/discover?search=all', '/booking/a?token=private', '/booking/a?serviceId=a%0ab', '/booking/a?date=2026-11-01&unexpected=yes']) assert.equal(safeAuthReturnTo(value), undefined, JSON.stringify(value));
});

test('canonical provider paths are bounded non-secret routes', async () => {
  const { providerSharePath } = await import('@visit/contracts');
  assert.equal(providerSharePath('clinic-a'), '/p/clinic-a');
  assert.equal(providerSharePath('a'.repeat(80)), '/p/' + 'a'.repeat(80));
  for (const value of [undefined, ['a'], 'a'.repeat(81), 'https://evil.test', 'a/b', 'a?token=x', 'a#x', 'a--b', '-a', 'a-']) assert.equal(providerSharePath(value), undefined);
});

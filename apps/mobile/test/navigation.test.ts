import assert from 'node:assert/strict';
import test from 'node:test';
import { menuCapabilities, type AccountNavigation } from '../src/lib/navigation';
const empty: AccountNavigation = { identity: { platformRole: 'CUSTOMER' }, memberships: [], providerApplications: [] };
const membership = (id: string, role = 'OWNER', status = 'ACTIVE', approvalStatus = 'APPROVED') => ({ role, status, business: { id, name: id, approvalStatus } });
test('menu capabilities distinguish ordinary, pending/rejected, approved and multiple-business identities', () => {
  assert.deepEqual(menuCapabilities(), { managed: [], applicationStatus: false, becomeProvider: false });
  assert.equal(menuCapabilities(empty).becomeProvider, true);
  const approved = menuCapabilities({ ...empty, memberships: [membership('approved')] });
  assert.equal(approved.managed.length, 1); assert.equal(approved.applicationStatus, false); assert.equal(approved.becomeProvider, false);
  for (const status of ['PENDING', 'REJECTED']) {
    const result = menuCapabilities({ ...empty, memberships: [membership('pending', 'OWNER', 'PENDING')], providerApplications: [{ id: 'application', status, business: { name: 'Pending business' } }] });
    assert.equal(result.managed.length, 0); assert.equal(result.applicationStatus, true); assert.equal(result.becomeProvider, false);
  }
  const result = menuCapabilities({ ...empty, memberships: [membership('a'), membership('b', 'MANAGER'), membership('staff', 'STAFF'), membership('suspended', 'OWNER', 'SUSPENDED'), membership('unapproved', 'OWNER', 'ACTIVE', 'PENDING')], providerApplications: [{ id: 'pending', status: 'PENDING', business: { name: 'Another application' } }] });
  assert.deepEqual(result.managed.map(m => m.business.id), ['a', 'b']); assert.equal(result.applicationStatus, true); assert.equal(result.becomeProvider, false);
});

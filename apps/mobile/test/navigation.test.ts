import assert from 'node:assert/strict';
import test from 'node:test';
import { menuCapabilities, PROVIDER_REGISTRATION_PATH, showsProviderEntry, type AccountNavigation } from '../src/lib/navigation';
import { safeAuthReturnTo } from '@visit/contracts';
const empty: AccountNavigation = { identity: { platformRole: 'CUSTOMER' }, memberships: [], providerApplications: [] };
const ALL = { seeAllCalendars: true, actOnAllCalendars: true, businessSetup: true, manageTeam: true }, NONE = { seeAllCalendars: false, actOnAllCalendars: false, businessSetup: false, manageTeam: false };
/** A membership as /v1/me returns it since slice 5: `MANAGER` and `STAFF` here are the presets of a MEMBER row. */
const membership = (id: string, preset: 'OWNER' | 'MANAGER' | 'STAFF' = 'OWNER', status = 'ACTIVE', approvalStatus = 'APPROVED') => ({ role: preset === 'OWNER' ? 'OWNER' : 'MEMBER', switches: preset === 'STAFF' ? NONE : ALL, status, business: { id, name: id, approvalStatus } });
test('menu capabilities distinguish ordinary, pending/rejected, approved and multiple-business identities', () => {
  assert.deepEqual(menuCapabilities(), { managed: [], applicationStatus: false, becomeProvider: false, reviewApplications: false });
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
test('without a calendar, a member opens provider mode only with "see other calendars"', () => {
  for (const name of ['actOnAllCalendars', 'businessSetup', 'manageTeam'] as const) assert.deepEqual(menuCapabilities({ ...empty, memberships: [{ ...membership('a', 'STAFF'), switches: { ...NONE, [name]: true } }] }).managed, [], name);
  const sees = menuCapabilities({ ...empty, memberships: [{ ...membership('a', 'STAFF'), switches: { ...NONE, seeAllCalendars: true } }] });
  assert.deepEqual(sees.managed.map(m => m.business.id), ['a']);
  // Only an owner or a full manager is past "become a provider".
  assert.equal(sees.becomeProvider, true);
});
test('only an administrator gets the application review menu entry', () => {
  assert.equal(menuCapabilities(empty).reviewApplications, false);
  assert.equal(menuCapabilities({ ...empty, identity: { platformRole: 'USER' } }).reviewApplications, false);
  assert.equal(menuCapabilities({ ...empty, identity: { platformRole: 'ADMIN' } }).reviewApplications, true);
});
test('login hides "Have a business?" only when it is already returning to the provider application', () => {
  assert.equal(showsProviderEntry(safeAuthReturnTo(PROVIDER_REGISTRATION_PATH)), false);
  assert.equal(showsProviderEntry(undefined), true);
  assert.equal(showsProviderEntry(safeAuthReturnTo('/')), true);
});
test('a worker linked to a calendar opens provider mode and can still apply for a business of their own', () => {
  const calendar = { id: 'row', displayName: 'Noa', active: true };
  const linked = menuCapabilities({ ...empty, memberships: [{ ...membership('salon', 'STAFF'), calendar }] });
  assert.deepEqual(linked.managed.map(m => [m.business.id, m.role]), [['salon', 'MEMBER']]);
  assert.equal(linked.becomeProvider, true);
  // Without a calendar a worker opens nothing (an invitation from before calendars, or a revoked link).
  assert.deepEqual(menuCapabilities({ ...empty, memberships: [{ ...membership('salon', 'STAFF'), calendar: null }] }).managed, []);
  // A linked manager is past "become a provider".
  const manager = menuCapabilities({ ...empty, memberships: [{ ...membership('salon', 'MANAGER'), calendar }] });
  assert.deepEqual(manager.managed.map(m => m.business.id), ['salon']); assert.equal(manager.becomeProvider, false);
});

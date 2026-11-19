import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderWorkspace } from '../src/lib/providerWorkspace';
const a = { id: 'a', name: 'A', timezone: 'Asia/Jerusalem' }, b = { ...a, id: 'b', name: 'B' };
test('provider selectors cannot fall back to another tenant; multiple workspaces require explicit choice', () => {
  assert.deepEqual(resolveProviderWorkspace([], undefined, null), { state: 'denied' });
  assert.deepEqual(resolveProviderWorkspace([a, b], undefined, null), { state: 'choose' });
  assert.deepEqual(resolveProviderWorkspace([a], undefined, null), { state: 'allowed', business: a });
  assert.deepEqual(resolveProviderWorkspace([a, b], undefined, 'b'), { state: 'allowed', business: b });
  assert.deepEqual(resolveProviderWorkspace([a, b], 'a', 'b'), { state: 'allowed', business: a });
  for (const selector of ['', ['a', 'b'], 'foreign', '../a', 'a/extra']) assert.deepEqual(resolveProviderWorkspace([a, b], selector, 'a'), { state: 'denied' });
  assert.deepEqual(resolveProviderWorkspace([b], 'a', 'a'), { state: 'denied' });
});
test("a worker's workspace is their own calendar; the owner's, or a member's who sees every calendar, is the whole business", async () => {
  const { workerCalendar, mayUse, workspaceKey } = await import('../src/lib/providerWorkspace');
  const calendar = { id: 'row', displayName: 'Noa', active: false };
  const none = { seeAllCalendars: false, actOnAllCalendars: false, businessSetup: false, manageTeam: false };
  assert.deepEqual(workerCalendar({ role: 'MEMBER', switches: none, calendar }), calendar);
  assert.equal(workerCalendar({ role: 'MEMBER', switches: { ...none, seeAllCalendars: true }, calendar }), null);
  assert.equal(workerCalendar({ role: 'OWNER' }), null);
  assert.equal(workerCalendar({ role: 'MEMBER', switches: none }), null);
  assert.deepEqual(resolveProviderWorkspace([{ ...a, role: 'MEMBER', calendar }], undefined, null), { state: 'allowed', business: { ...a, role: 'MEMBER', calendar } });
  // Each switch opens its own part of provider mode; the owner holds them all.
  assert.equal(mayUse({ role: 'OWNER' }, 'businessSetup'), true);
  assert.equal(mayUse({ role: 'MEMBER', switches: { ...none, businessSetup: true } }, 'businessSetup'), true);
  assert.equal(mayUse({ role: 'MEMBER', switches: { ...none, businessSetup: true } }, 'manageTeam'), false);
  assert.equal(mayUse(undefined, 'manageTeam'), false);
  // A switch change remounts provider mode, like a role change.
  assert.notEqual(workspaceKey({ role: 'MEMBER', switches: none, calendar }), workspaceKey({ role: 'MEMBER', switches: { ...none, businessSetup: true }, calendar }));
});

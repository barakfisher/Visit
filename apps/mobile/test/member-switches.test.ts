import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMBER_SWITCHES, NO_SWITCHES, memberLabel, opensWorkspace, sameSwitches, withSwitch, type MemberSwitches } from '../src/lib/MemberSwitches';

const ALL: MemberSwitches = { seeAllCalendars: true, actOnAllCalendars: true, businessSetup: true, manageTeam: true };

// decisions.md, "Switches": the label is Manager when all four are on, otherwise Worker plus its extra permissions.
test('the card label comes from the switches', () => {
  assert.deepEqual(memberLabel('OWNER', NO_SWITCHES), { kind: 'owner' });
  assert.deepEqual(memberLabel('MEMBER', ALL), { kind: 'manager' });
  assert.deepEqual(memberLabel('MEMBER', NO_SWITCHES), { kind: 'worker', extras: [] });
  assert.deepEqual(memberLabel('MEMBER', { ...ALL, manageTeam: false }), { kind: 'worker', extras: ['seeAllCalendars', 'actOnAllCalendars', 'businessSetup'] });
  for (const name of MEMBER_SWITCHES) assert.deepEqual(memberLabel('MEMBER', { ...NO_SWITCHES, [name]: true }), { kind: 'worker', extras: [name] });
});

test('acting on other calendars needs seeing them, both ways', () => {
  assert.deepEqual(withSwitch(NO_SWITCHES, 'actOnAllCalendars', true), { ...NO_SWITCHES, seeAllCalendars: true, actOnAllCalendars: true });
  assert.deepEqual(withSwitch({ ...NO_SWITCHES, seeAllCalendars: true, actOnAllCalendars: true }, 'seeAllCalendars', false), NO_SWITCHES);
  assert.deepEqual(withSwitch(ALL, 'actOnAllCalendars', false), { ...ALL, actOnAllCalendars: false });
  assert.deepEqual(withSwitch(NO_SWITCHES, 'businessSetup', true), { ...NO_SWITCHES, businessSetup: true });
  assert.equal(sameSwitches(ALL, { ...ALL }), true);
  assert.equal(sameSwitches(ALL, NO_SWITCHES), false);
});

test('without a calendar a member opens provider mode only with "see"', () => {
  assert.equal(opensWorkspace('OWNER', undefined, false), true);
  assert.equal(opensWorkspace('MEMBER', NO_SWITCHES, true), true);
  assert.equal(opensWorkspace('MEMBER', { ...NO_SWITCHES, seeAllCalendars: true }, false), true);
  for (const name of ['actOnAllCalendars', 'businessSetup', 'manageTeam'] as const) assert.equal(opensWorkspace('MEMBER', { ...NO_SWITCHES, [name]: true }, false), false, name);
});

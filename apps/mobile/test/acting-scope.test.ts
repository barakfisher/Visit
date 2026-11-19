import assert from 'node:assert/strict';
import test from 'node:test';
import { actsOn, blockableStaff, blockStart, pinnedCalendar, type ActingScope } from '../src/lib/ActingScope';
import { mayAddAppointment, ownCalendar } from '../src/lib/providerWorkspace';

// "See" and "act" are separate switches (decisions.md, "Switches"): what a member sees is not what they may change.
const ALL: ActingScope = { all: true, staffId: null }, OWN: ActingScope = { all: false, staffId: 'mine' };
const staff = [{ id: 'mine', displayName: 'Noa' }, { id: 'other', displayName: 'Dana' }];

test('a member acts on every row, on their own row only, or on none', () => {
  assert.deepEqual([actsOn(ALL, 'mine'), actsOn(ALL, 'other')], [true, true]);
  assert.deepEqual([actsOn(OWN, 'mine'), actsOn(OWN, 'other'), actsOn(OWN, null), actsOn(OWN, undefined)], [true, false, false, false]);
  for (const act of [null, undefined]) assert.deepEqual([actsOn(act, 'mine'), actsOn(act, null)], [false, false]);
});

test('a block names only rows the member acts on, and the whole business only with setup', () => {
  assert.deepEqual(blockableStaff(ALL, staff), staff);
  assert.deepEqual(blockableStaff(OWN, staff), [staff[0]]);
  assert.deepEqual(blockableStaff(null, staff), []);
  assert.deepEqual([pinnedCalendar(ALL), pinnedCalendar(OWN), pinnedCalendar(null)], [undefined, 'mine', undefined]);
  assert.equal(blockStart(true, staff), undefined, 'with setup a block starts on the whole business');
  assert.equal(blockStart(false, blockableStaff(OWN, staff)), 'mine');
  assert.equal(blockStart(false, []), undefined);
});

test('Add appointment follows "act", or the member\'s own calendar, never "see" alone', () => {
  const none = { seeAllCalendars: false, actOnAllCalendars: false, businessSetup: false, manageTeam: false };
  const calendar = { id: 'mine', displayName: 'Noa', active: true };
  const see = { ...none, seeAllCalendars: true };
  // A linked member who sees everything still adds on their own calendar; that is what QA found missing.
  assert.equal(mayAddAppointment({ role: 'MEMBER', switches: see, calendar }, false), true);
  assert.equal(mayAddAppointment({ role: 'MEMBER', switches: see, calendar: { ...calendar, active: false } }, true), false);
  assert.equal(mayAddAppointment({ role: 'MEMBER', switches: see }, true), false, 'see alone, no calendar: nowhere to add');
  assert.equal(mayAddAppointment({ role: 'MEMBER', switches: { ...see, actOnAllCalendars: true } }, false), true, 'act without setup needs no setup');
  const manager = { seeAllCalendars: true, actOnAllCalendars: true, businessSetup: true, manageTeam: true };
  assert.deepEqual([mayAddAppointment({ role: 'MEMBER', switches: manager }, false), mayAddAppointment({ role: 'MEMBER', switches: manager }, true)], [false, true]);
  assert.deepEqual([mayAddAppointment({ role: 'OWNER' }, false), mayAddAppointment({ role: 'OWNER' }, true), mayAddAppointment(undefined, true)], [false, true, false]);
  assert.equal(ownCalendar({ role: 'OWNER', calendar }), null, 'an owner is never linked');
});

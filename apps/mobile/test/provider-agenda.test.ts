import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleDraft, scheduleProposal } from '../src/lib/WeeklyHours';
import { emptyAgendaDraft, useAgendaDraft } from '../src/state/ProviderAgenda.store';

test('schedule draft fills closed days and copies source rows before edits', () => {
  assert.deepEqual(scheduleDraft(), { weekly: [[], [], [], [], [], [], []] });
  const rules = { weekly: [{ weekday: 1, startLocal: '09:00', endLocal: '12:00' }, { weekday: 1, startLocal: '13:00', endLocal: '18:00' }] };
  const before = structuredClone(rules), draft = scheduleDraft(rules);
  assert.equal(draft.weekly.length, 7); assert.equal(draft.weekly[1]?.length, 2);
  const first = draft.weekly[1]?.[0];
  assert.ok(first); first.startLocal = '10:00';
  assert.deepEqual(rules, before);
});

test('schedule proposals preserve split windows and send weekly hours only', () => {
  const draft = scheduleDraft({ weekly: [{ weekday: 2, startLocal: '13:00', endLocal: '18:00' }, { weekday: 2, startLocal: '09:00', endLocal: '12:00' }] });
  const before = structuredClone(draft), proposal = scheduleProposal(draft);
  assert.equal(proposal.weekly.length, 7);
  assert.deepEqual(proposal.weekly[2], { weekday: 2, intervals: [{ startLocal: '09:00', endLocal: '12:00' }, { startLocal: '13:00', endLocal: '18:00' }] });
  // Date overrides became time blocks; the API refuses a proposal that still carries them.
  assert.deepEqual(Object.keys(proposal), ['weekly']);
  assert.deepEqual(draft, before);
});

test('agenda draft patches stay in identity/business scope and clear on leaving', () => {
  useAgendaDraft.getState().clear();
  useAgendaDraft.getState().update('identity-a:business-a', { date: '2027-03-15' });
  useAgendaDraft.getState().update('identity-a:business-a', { mode: 'week' });
  assert.deepEqual(useAgendaDraft.getState().draft, { date: '2027-03-15', mode: 'week' });
  useAgendaDraft.getState().update('identity-a:business-b', { mode: 'week' });
  assert.deepEqual(useAgendaDraft.getState().draft, { ...emptyAgendaDraft, mode: 'week' });
  useAgendaDraft.getState().update('identity-b:business-b', { date: '2027-03-16' });
  assert.equal(useAgendaDraft.getState().draft.mode, emptyAgendaDraft.mode);
  useAgendaDraft.getState().clear();
  assert.equal(useAgendaDraft.getState().scope, '');
  assert.deepEqual(useAgendaDraft.getState().draft, emptyAgendaDraft);
});

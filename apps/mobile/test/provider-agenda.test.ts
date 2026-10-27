import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleDraft, scheduleProposal } from '../src/lib/ScheduleEditor.utils';
import { emptyAgendaDraft, useAgendaDraft } from '../src/state/ProviderAgenda.store';

test('schedule draft fills closed days and copies source rows before edits', () => {
  assert.deepEqual(scheduleDraft(), { weekly: [[], [], [], [], [], [], []], overrides: [] });
  const rules = { weekly: [{ weekday: 1, startLocal: '09:00', endLocal: '12:00' }, { weekday: 1, startLocal: '13:00', endLocal: '18:00' }], overrides: [{ date: '2027-03-15T00:00:00.000Z', isOpen: false, startLocal: null, endLocal: null }] };
  const before = structuredClone(rules), draft = scheduleDraft(rules);
  assert.equal(draft.weekly.length, 7); assert.equal(draft.weekly[1]?.length, 2);
  assert.equal(draft.overrides[0]?.date, '2027-03-15');
  const first = draft.weekly[1]?.[0], exception = draft.overrides[0];
  assert.ok(first); assert.ok(exception); first.startLocal = '10:00'; exception.date = '2027-03-16';
  assert.deepEqual(rules, before);
});

test('schedule proposals preserve split windows and omit closed exception times', () => {
  const draft = scheduleDraft({ weekly: [], overrides: [{ date: '2027-03-15', isOpen: false, startLocal: '09:00', endLocal: '18:00' }, { date: '2027-03-16', isOpen: true, startLocal: '10:00', endLocal: '12:00' }] });
  const before = structuredClone(draft), proposal = scheduleProposal(draft);
  assert.equal(proposal.weekly.length, 7);
  assert.deepEqual(proposal.overrides, [{ date: '2027-03-15', isOpen: false }, { date: '2027-03-16', isOpen: true, startLocal: '10:00', endLocal: '12:00' }]);
  assert.deepEqual(draft, before);
});

test('agenda draft patches stay in identity/business scope and clear sensitive transient input', () => {
  useAgendaDraft.getState().clear();
  useAgendaDraft.getState().update('identity-a:business-a', { reason: 'Private break', staffId: 'staff-a', blockOpen: true, date: '2027-03-15' });
  useAgendaDraft.getState().update('identity-a:business-a', { mode: 'week' });
  assert.equal(useAgendaDraft.getState().draft.reason, 'Private break');
  useAgendaDraft.getState().update('identity-a:business-b', { tab: 'hours' });
  assert.deepEqual(useAgendaDraft.getState().draft, { ...emptyAgendaDraft, tab: 'hours' });
  useAgendaDraft.getState().update('identity-b:business-b', { reason: 'Second identity' });
  assert.equal(useAgendaDraft.getState().draft.tab, 'agenda');
  useAgendaDraft.getState().clear();
  assert.equal(useAgendaDraft.getState().scope, '');
  assert.deepEqual(useAgendaDraft.getState().draft, emptyAgendaDraft);
});

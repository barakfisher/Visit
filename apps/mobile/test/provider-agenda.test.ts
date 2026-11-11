import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleDraft, scheduleProposal } from '../src/lib/WeeklyHours';
import { emptyAgendaDraft, useAgendaDraft } from '../src/state/ProviderAgenda.store';
import { AGENDA_RECHECK_MAX_MS, nextAgendaRecheck, splitAgendaToday } from '../src/lib/AgendaToday.utils';

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

test('the saved-day notice on the home stays in identity/business scope and clears on leaving', () => {
  useAgendaDraft.getState().clear();
  const saved = '2027-03-15';
  useAgendaDraft.getState().update('identity-a:business-a', { savedDate: saved });
  assert.deepEqual(useAgendaDraft.getState().draft, { savedDate: saved });
  useAgendaDraft.getState().update('identity-a:business-b', {});
  assert.deepEqual(useAgendaDraft.getState().draft, emptyAgendaDraft);
  useAgendaDraft.getState().update('identity-a:business-a', { savedDate: saved });
  useAgendaDraft.getState().clear();
  assert.equal(useAgendaDraft.getState().scope, '');
  assert.deepEqual(useAgendaDraft.getState().draft, emptyAgendaDraft);
});

const at = (iso: string) => Date.parse(iso);
const appointment = (id: string, status: string, endsAt: string) => ({ id, status, endsAt });

test('today splits into appointments still to come and those that ended, without cancelled ones', () => {
  const now = at('2027-03-15T10:00:00Z');
  const bookings = [
    appointment('ended', 'CONFIRMED', '2027-03-15T09:30:00Z'), appointment('ending-now', 'CONFIRMED', '2027-03-15T10:00:00Z'),
    appointment('running', 'CONFIRMED', '2027-03-15T10:15:00Z'), appointment('later', 'CONFIRMED', '2027-03-15T15:00:00Z'),
    appointment('cancelled-later', 'CANCELLED', '2027-03-15T16:00:00Z'), appointment('cancelled-earlier', 'CANCELLED', '2027-03-15T08:00:00Z'),
    appointment('no-show', 'NO_SHOW', '2027-03-15T08:30:00Z'), appointment('completed', 'COMPLETED', '2027-03-15T09:00:00Z'),
  ];
  const { upcoming, ended } = splitAgendaToday(bookings, now);
  // An appointment under way stays with those to come until it ends; order is the server's.
  assert.deepEqual(upcoming.map(row => row.id), ['running', 'later']);
  assert.deepEqual(ended.map(row => row.id), ['ended', 'ending-now', 'no-show', 'completed']);
});

test('the home looks at the clock again when the next appointment ends, and at least every recheck interval', () => {
  const now = at('2027-03-15T10:00:00Z'), soon = 5 * 60_000;
  const bookings = [appointment('later', 'CONFIRMED', new Date(now + AGENDA_RECHECK_MAX_MS * 2).toISOString()), appointment('next', 'CONFIRMED', new Date(now + soon).toISOString()), appointment('cancelled', 'CANCELLED', new Date(now + 1000).toISOString())];
  assert.equal(nextAgendaRecheck(bookings, now), soon);
  assert.equal(nextAgendaRecheck([], now), AGENDA_RECHECK_MAX_MS);
  assert.equal(nextAgendaRecheck([bookings[0]!], now), AGENDA_RECHECK_MAX_MS);
});

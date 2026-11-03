import assert from 'node:assert/strict';
import test from 'node:test';
import { historyEntries } from '../src/lib/AppointmentHistory';

const past = { id: 'past' }, upcoming = { id: 'upcoming' }, history = [past, upcoming];

test('history leaves out the appointments the upcoming list shows', () => {
  assert.deepEqual(historyEntries(history, { status: 'success', ids: [upcoming.id] }), [past]);
  assert.deepEqual(historyEntries(history, { status: 'success', ids: [] }), history);
});

test('history can be empty once the upcoming appointments are left out', () => {
  assert.deepEqual(historyEntries([upcoming], { status: 'success', ids: [upcoming.id] }), []);
});

test('history waits for the upcoming list, so nothing appears and then vanishes', () => {
  assert.equal(historyEntries(history, { status: 'pending', ids: [] }), null);
});

test('history shows everything when the upcoming list failed, so no appointment goes missing', () => {
  assert.deepEqual(historyEntries(history, { status: 'error', ids: [] }), history);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { historyEntries } from '../src/lib/AppointmentHistory';

const past = { id: 'past', startsAt: '2026-11-01T08:00:00.000Z' }, upcoming = { id: 'upcoming', startsAt: '2026-11-09T08:00:00.000Z' }, history = [past, upcoming];

test('history leaves out the appointments the upcoming list shows', () => {
  assert.deepEqual(historyEntries(history, { status: 'success', ids: [upcoming.id] }), [past]);
  assert.deepEqual(historyEntries(history, { status: 'success', ids: [] }), [upcoming, past]);
});

test('history can be empty once the upcoming appointments are left out', () => {
  assert.deepEqual(historyEntries([upcoming], { status: 'success', ids: [upcoming.id] }), []);
});

test('history waits for the upcoming list, so nothing appears and then vanishes', () => {
  assert.equal(historyEntries(history, { status: 'pending', ids: [] }), null);
});

test('history shows everything when the upcoming list failed, so no appointment goes missing', () => {
  assert.deepEqual(historyEntries(history, { status: 'error', ids: [] }), [upcoming, past]);
});

test('history lists the latest appointment first and leaves the server list untouched', () => {
  const earlier = { id: 'earlier', startsAt: '2026-10-20T08:00:00.000Z' }, server = [earlier, past, upcoming], before = structuredClone(server);
  assert.deepEqual(historyEntries(server, { status: 'success', ids: [] })?.map(booking => booking.id), ['upcoming', 'past', 'earlier']);
  assert.deepEqual(server, before);
});

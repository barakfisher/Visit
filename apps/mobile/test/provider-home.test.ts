import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentsAt, providerContacts, providerWeek } from '../src/lib/ProviderHome';
import { WEEKDAYS } from '../src/lib/WeeklyHours';

const at = (id: string, business: string) => ({ id, business: { id: business } });

test('a business page lists only that business, in the order the server gave', () => {
  const all = [at('1', 'a'), at('2', 'b'), at('3', 'a')];
  assert.deepEqual(appointmentsAt(all, 'a').map(item => item.id), ['1', '3']);
  assert.deepEqual(appointmentsAt(all, 'missing'), []);
  assert.deepEqual(appointmentsAt(all).map(item => item.id), ['1', '2', '3']);
  assert.notEqual(appointmentsAt(all), all);
});

test('contact shows only what the owner filled in, and nothing when nothing is', () => {
  assert.equal(providerContacts({ contactPhone: null, contactEmail: '  ', location: null }), null);
  assert.deepEqual(providerContacts({ contactPhone: ' +972501234567 ', contactEmail: null, location: null }), { phone: '+972501234567', email: null, location: null });
  assert.deepEqual(providerContacts({ contactPhone: null, contactEmail: null, location: 'Tel Aviv' }), { phone: null, email: null, location: 'Tel Aviv' });
});

test('weekly rows become a week from Sunday with each day in order', () => {
  const week = providerWeek([{ weekday: 2, startLocal: '14:00', endLocal: '18:00' }, { weekday: 2, startLocal: '09:00', endLocal: '12:00' }, { weekday: 0, startLocal: '10:00', endLocal: '16:00' }]);
  assert.equal(week.length, WEEKDAYS.length);
  assert.deepEqual(week[0], [{ startLocal: '10:00', endLocal: '16:00' }]);
  assert.deepEqual(week[2], [{ startLocal: '09:00', endLocal: '12:00' }, { startLocal: '14:00', endLocal: '18:00' }]);
  assert.deepEqual(week[1], []);
  assert.ok(providerWeek([]).every(day => !day.length));
});

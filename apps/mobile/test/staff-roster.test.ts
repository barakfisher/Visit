import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/apiClient';
import { staffEn, staffHe } from '../src/i18n/staffMessages';
import { MAX_CAPACITY, MAX_STAFF_NAME, MIN_CAPACITY, MIN_STAFF_NAME, STAFF_HAS_APPOINTMENTS, assignedServiceNames, capacityText, emptyStaffDraft, isCapacityInUse, selfStaffDraft, staffDraft, staffInput, staffRemovalConflicts, validateStaffDraft, type RosterStaff } from '../src/lib/StaffRoster';

const staff: RosterStaff = { id: 'p1', displayName: 'Noa', active: false, parallelCapacity: 3, services: [
  { serviceId: 'paused', service: { id: 'paused', name: 'Colour' } },
  { serviceId: 'cut', service: { id: 'cut', name: 'Beard trim' } },
] };
const catalog = [{ id: 'cut', name: 'Beard trim', active: true }, { id: 'paused', name: 'Colour', active: false }];

test('capacity accepts digits only, typed or pasted, and never more digits than the largest value', () => {
  assert.equal(capacityText('a1b2'), '12');
  assert.equal(capacityText('-3'), '3');
  assert.equal(capacityText('2.5'), '25');
  assert.equal(capacityText(' 4 '), '4');
  assert.equal(capacityText('שתיים'), '');
  assert.equal(capacityText('١٢'), '');
  assert.equal(capacityText('123456'), '123456'.slice(0, String(MAX_CAPACITY).length));
});

test('capacity outside the API range is a field error, not a request', () => {
  const ready = { ...emptyStaffDraft(), name: 'Noa', serviceIds: ['cut'] };
  assert.deepEqual(validateStaffDraft(ready), {});
  for (const capacity of ['', '0', String(MAX_CAPACITY + 1), String(MIN_CAPACITY - 1)]) assert.deepEqual(validateStaffDraft({ ...ready, capacity }), { capacity: 'capacity' }, capacity);
  for (const capacity of [String(MIN_CAPACITY), String(MAX_CAPACITY)]) assert.deepEqual(validateStaffDraft({ ...ready, capacity }), {}, capacity);
});

test('a name within the API limits and at least one service are required', () => {
  const ready = { ...emptyStaffDraft(), name: 'Noa', serviceIds: ['cut'] };
  assert.deepEqual(validateStaffDraft({ ...ready, name: ` ${'x'.repeat(MIN_STAFF_NAME - 1)} ` }), { name: 'name' });
  assert.deepEqual(validateStaffDraft({ ...ready, name: 'x'.repeat(MAX_STAFF_NAME + 1) }), { name: 'name' });
  assert.deepEqual(validateStaffDraft({ ...ready, serviceIds: [] }), { services: 'services' });
});

test('a new staff member starts at the minimum capacity, available, and is sent without the switch', () => {
  const draft = emptyStaffDraft();
  assert.equal(draft.capacity, String(MIN_CAPACITY));
  assert.equal(draft.active, true);
  const input = staffInput({ ...draft, name: '  Noa ', serviceIds: ['cut'] }, false);
  assert.deepEqual(input, { displayName: 'Noa', serviceIds: ['cut'], parallelCapacity: MIN_CAPACITY });
});

test('editing starts from the saved values, drops a paused service and sends the switch', () => {
  const draft = staffDraft(staff, catalog);
  assert.deepEqual(draft, { name: 'Noa', capacity: '3', serviceIds: ['cut'], active: false });
  assert.deepEqual(staffInput({ ...draft, active: true }, true), { displayName: 'Noa', serviceIds: ['cut'], parallelCapacity: 3, active: true });
});

test('the card shows every assigned service, paused ones included, in alphabetical order', () => {
  assert.deepEqual(assignedServiceNames(staff, 'en'), ['Beard trim', 'Colour']);
});

test('a refused removal lists its upcoming appointments; any other failure does not', () => {
  const conflict = { kind: 'APPOINTMENT' as const, id: 'b1', startsAt: '2026-11-03T08:00:00.000Z', endsAt: '2026-11-03T08:30:00.000Z', staffName: 'Noa', customerName: 'Dana', serviceName: 'Beard trim' };
  const refused = new ApiError('busy', STAFF_HAS_APPOINTMENTS, 409, undefined, { total: 21, timezone: 'Asia/Jerusalem', conflicts: [conflict] });
  assert.deepEqual(staffRemovalConflicts(refused), { total: 21, timezone: 'Asia/Jerusalem', conflicts: [conflict] });
  assert.deepEqual(staffRemovalConflicts(new ApiError('odd', STAFF_HAS_APPOINTMENTS, 409)), { total: 0, timezone: '', conflicts: [] });
  assert.equal(staffRemovalConflicts(new ApiError('gone', 'NOT_FOUND', 404)), null);
  assert.equal(staffRemovalConflicts(new Error('offline')), null);
});

test('only the plain capacity conflict is read as "capacity already in use"', () => {
  assert.equal(isCapacityInUse(new ApiError('lower', 'CONFLICT', 409)), true);
  assert.equal(isCapacityInUse(new ApiError('busy', STAFF_HAS_APPOINTMENTS, 409)), false);
  assert.equal(isCapacityInUse(new ApiError('bad', 'VALIDATION_ERROR', 400)), false);
});

test('Hebrew has every staff message, and the availability hint names the person', () => {
  assert.deepEqual(Object.keys(staffHe).sort(), Object.keys(staffEn).sort());
  assert.match(staffEn['roster.availableHint'], /\{name\}/);
  assert.match(staffHe['roster.availableHint'], /\{name\}/);
});

test('"Add myself" starts from the account name and every active service, ready to save', () => {
  const services = [{ id: 'cut', name: 'Cut', active: true }, { id: 'paused', name: 'Colour', active: false }, { id: 'beard', name: 'Beard', active: true }];
  const draft = selfStaffDraft('  Dana  ', services);
  assert.deepEqual(draft, { name: 'Dana', capacity: String(MIN_CAPACITY), serviceIds: ['cut', 'beard'], active: true });
  assert.deepEqual(validateStaffDraft(draft), {});
  assert.equal(selfStaffDraft(null, services).name, '', 'no name on the account leaves the field for the owner');
});

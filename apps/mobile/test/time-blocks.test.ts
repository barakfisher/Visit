import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/apiClient';
import { BLOCK_CONFLICT, MAX_BLOCK_DAYS, MAX_BLOCK_REASON, blockConflicts, blockDates, blockInput, emptyBlockForm, validateBlockForm, type BlockForm } from '../src/lib/TimeBlocks';
import { addBookingDays } from '../src/lib/CompactBooking.utils';

const today = '2026-11-02';
const hours = (patch: Partial<BlockForm> = {}): BlockForm => ({ ...emptyBlockForm('2026-11-05'), ...patch });
const days = (patch: Partial<BlockForm> = {}): BlockForm => ({ ...emptyBlockForm('2026-11-05'), kind: 'days', fromDate: '2026-12-24', toDate: '2026-12-26', ...patch });

test('a new block is an hour on the chosen date for the whole business', () => {
  assert.deepEqual(emptyBlockForm('2026-11-05'), { staffId: '', kind: 'hours', date: '2026-11-05', startLocal: '12:00', endLocal: '13:00', fromDate: '2026-11-05', toDate: '2026-11-05', reason: '' });
  assert.deepEqual(validateBlockForm(hours(), today), {});
  assert.deepEqual(validateBlockForm(days(), today), {});
});

test('hours need a real date that has not passed and an increasing HH:mm range', () => {
  assert.deepEqual(validateBlockForm(hours({ date: '2026-02-30' }), today), { date: 'date' });
  assert.deepEqual(validateBlockForm(hours({ date: '2026-11-01' }), today), { date: 'past' });
  assert.deepEqual(validateBlockForm(hours({ date: today }), today), {}, 'today is allowed; the server refuses a time already over');
  assert.deepEqual(validateBlockForm(hours({ startLocal: '9:00', endLocal: '24:00' }), today), { startLocal: 'format', endLocal: 'format' });
  assert.deepEqual(validateBlockForm(hours({ startLocal: '13:00', endLocal: '13:00' }), today), { endLocal: 'order' });
  assert.deepEqual(validateBlockForm(hours({ startLocal: '14:00', endLocal: '13:00' }), today), { endLocal: 'order' });
});

test('whole days include both ends, run forward, stay within the API limit and must not be over', () => {
  assert.deepEqual(validateBlockForm(days({ fromDate: '2026-12-26', toDate: '2026-12-24' }), today), { toDate: 'range' });
  assert.deepEqual(validateBlockForm(days({ fromDate: 'soon', toDate: 'later' }), today), { fromDate: 'date', toDate: 'date' });
  const first = '2027-01-01';
  assert.deepEqual(validateBlockForm(days({ fromDate: first, toDate: addBookingDays(first, MAX_BLOCK_DAYS - 1) }), today), {});
  assert.deepEqual(validateBlockForm(days({ fromDate: first, toDate: addBookingDays(first, MAX_BLOCK_DAYS) }), today), { toDate: 'tooLong' });
  assert.deepEqual(validateBlockForm(days({ fromDate: '2026-10-01', toDate: '2026-11-01' }), today), { toDate: 'past' });
  assert.deepEqual(validateBlockForm(days({ fromDate: '2026-10-01', toDate: today }), today), {}, 'a range ending today still blocks the rest of today');
});

test('the reason is optional, trimmed and bounded', () => {
  assert.deepEqual(validateBlockForm(hours({ reason: 'x'.repeat(MAX_BLOCK_REASON) }), today), {});
  assert.deepEqual(validateBlockForm(hours({ reason: 'x'.repeat(MAX_BLOCK_REASON + 1) }), today), { reason: 'reason' });
  assert.deepEqual(blockInput(hours({ reason: '  Holiday  ' }), 'business-1'), { businessId: 'business-1', reason: 'Holiday', kind: 'hours', date: '2026-11-05', startLocal: '12:00', endLocal: '13:00' });
});

test('the request names a staff member only when one is chosen, and sends only the chosen kind', () => {
  assert.deepEqual(blockInput(days({ staffId: 'staff-1' }), 'business-1'), { businessId: 'business-1', staffId: 'staff-1', kind: 'days', fromDate: '2026-12-24', toDate: '2026-12-26' });
  assert.equal('staffId' in blockInput(days(), 'business-1'), false, 'no staff member means the whole business');
  assert.equal('reason' in blockInput(hours({ reason: '   ' }), 'business-1'), false);
});

test('a refused block exposes its conflicts; any other failure does not', () => {
  const conflicts = [{ kind: 'RESERVATION' as const, startsAt: '2026-12-24T08:00:00.000Z', endsAt: '2026-12-24T08:30:00.000Z', staffName: 'Noa' }];
  assert.deepEqual(blockConflicts(new ApiError('refused', BLOCK_CONFLICT, 409, undefined, { total: 3, conflicts })), { total: 3, conflicts });
  assert.deepEqual(blockConflicts(new ApiError('refused', BLOCK_CONFLICT, 409)), { total: 0, conflicts: [] }, 'missing details still reads as a conflict');
  assert.equal(blockConflicts(new ApiError('other', 'CONFLICT', 409)), null);
  assert.equal(blockConflicts(new Error('offline')), null);
});

test('block dates read from the local date alone, one date or a range', () => {
  assert.equal(blockDates({ fromDate: '2026-12-24', toDate: '2026-12-24' }, 'en'), 'Thu, 24 Dec 2026');
  assert.equal(blockDates({ fromDate: '2026-12-24', toDate: '2026-12-26' }, 'en'), 'Thu, 24 Dec 2026 – Sat, 26 Dec 2026');
  assert.match(blockDates({ fromDate: '2026-12-24', toDate: '2026-12-24' }, 'he'), /24/);
});

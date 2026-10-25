import assert from 'node:assert/strict';
import test from 'node:test';
import { slotLabels } from '../src/lib/slotLabels';
test('repeated DST clock times show first/second occurrences for the same staff resource', () => {
  assert.deepEqual(slotLabels([
    { staffId: 'a', staffName: 'Alex', localTime: '01:30', utcOffset: '+03:00' },
    { staffId: 'a', staffName: 'Alex', localTime: '01:30', utcOffset: '+02:00' },
    { staffId: 'b', staffName: 'Sam', localTime: '01:30', utcOffset: '+02:00' },
  ]), ['01:30 (first occurrence) · Alex', '01:30 (second occurrence) · Alex', '01:30 · Sam']);
});

test('fold labels are ordered by instants, including negative legacy offsets and reversed results', () => {
  const slots = [{ staffId: 'a', staffName: 'Alex', localTime: '01:30', utcOffset: '-05:00' }, { staffId: 'a', staffName: 'Alex', localTime: '01:30', utcOffset: '-04:00' }];
  assert.deepEqual(slotLabels(slots), ['01:30 (second occurrence) · Alex', '01:30 (first occurrence) · Alex']);
  assert.match(slotLabels(slots, 'he')[0]!, /מופע שני/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { slotLabels } from '../src/lib/slotLabels';
test('repeated DST clock times show distinct offsets for the same staff resource', () => {
  assert.deepEqual(slotLabels([
    { staffId: 'a', staffName: 'Alex', localTime: '01:30', utcOffset: '+03:00' },
    { staffId: 'a', staffName: 'Alex', localTime: '01:30', utcOffset: '+02:00' },
    { staffId: 'b', staffName: 'Sam', localTime: '01:30', utcOffset: '+02:00' },
  ]), ['01:30 (UTC+03:00) · Alex', '01:30 (UTC+02:00) · Alex', '01:30 · Sam']);
});

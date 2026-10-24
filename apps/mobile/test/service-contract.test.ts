import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServicePrice, validateService } from '@visit/contracts';
test('client service form uses the exact shared server validation contract', () => {
  assert.equal(parseServicePrice('19.99'), 1999);
  assert.equal(parseServicePrice('1.005'), undefined);
  assert.equal(parseServicePrice('1e2'), undefined);
  assert.deepEqual(validateService({ name: 'Haircut', durationMinutes: 30, priceMinor: 1999, currency: 'ILS' }), {});
  assert.deepEqual(validateService({ name: ' ', durationMinutes: 0, priceMinor: NaN, currency: 'JPY' }), { name: 'name', durationMinutes: 'duration', priceMinor: 'price', currency: 'currency' });
  assert.equal(validateService({ name: 'Haircut', durationMinutes: 30, priceMinor: 0 }).priceMinor, 'pair');
});

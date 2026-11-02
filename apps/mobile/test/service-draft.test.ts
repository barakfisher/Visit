import assert from 'node:assert/strict';
import test from 'node:test';
import { validateService } from '@visit/contracts';
import { DEFAULT_SERVICE_CURRENCY, emptyServiceDraft, serviceDraft, serviceInput, type CatalogService } from '../src/lib/ServiceDraft';

const service: CatalogService = { id: 's1', name: 'Haircut', description: null, durationMinutes: 45, priceMinor: 1999, currency: 'USD', active: false };

test('a new priced service is sent in the default currency, with no currency field to fill', () => {
  const input = serviceInput({ ...emptyServiceDraft(), name: 'Consultation', price: '120' }, false);
  assert.equal(input.currency, DEFAULT_SERVICE_CURRENCY);
  assert.equal(input.priceMinor, 12000);
  assert.equal('active' in input, false);
  assert.deepEqual(validateService(input), {});
});

test('a service without a price is sent without a currency', () => {
  const input = serviceInput({ ...emptyServiceDraft(), name: 'Consultation' }, false);
  assert.equal(input.priceMinor, null);
  assert.equal(input.currency, null);
  assert.deepEqual(validateService(input), {});
});

test('editing keeps the stored currency and sends the availability switch', () => {
  const draft = serviceDraft(service);
  assert.equal(draft.price, '19.99');
  assert.equal(draft.active, false);
  const input = serviceInput({ ...draft, active: true }, true);
  assert.equal(input.currency, service.currency);
  assert.equal(input.active, true);
  assert.deepEqual(validateService(input), {});
});

test('unparseable numbers reach the shared contract as field errors', () => {
  const input = serviceInput({ ...emptyServiceDraft(), name: 'Consultation', duration: 'ten', price: '1.005' }, false);
  assert.deepEqual(validateService(input), { durationMinutes: 'duration', priceMinor: 'price' });
});

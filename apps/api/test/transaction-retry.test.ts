import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/http/errors.js';
import { isTransactionConflict, retrySerializable } from '../src/scheduling/booking-transaction.js';

const adapterConflict = { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict' } };

test('raw-query serialization and deadlock failures are retried only with structured evidence', async () => {
  for (const failure of [
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
    { code: 'P2010', meta: { driverAdapterError: adapterConflict } },
  ]) {
    assert.equal(isTransactionConflict(failure), true);
    let calls = 0;
    const result = await retrySerializable(async () => {
      if (++calls < 3) throw failure;
      return { committed: true };
    });
    assert.deepEqual(result, { committed: true });
    assert.equal(calls, 3);
  }
});

test('malformed, unrelated, and message-only failures are never replayed', async () => {
  for (const failure of [
    null, undefined, '', 40001, {},
    { code: 'P2010', meta: null },
    { code: 'P2010', meta: { code: 40001 } },
    { code: 'P2010', meta: { code: '23505' } },
    { code: 'P2010', meta: { message: '40001 TransactionWriteConflict' } },
    { code: 'P2010', meta: { driverAdapterError: { ...adapterConflict, name: 'Error' } } },
    { code: 'P2010', meta: { driverAdapterError: { name: 'DriverAdapterError', cause: null } } },
    { code: 'P2010', meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'ConnectionClosed' } } } },
    { code: 'P2002', meta: { code: '40001', driverAdapterError: adapterConflict } },
  ]) {
    assert.equal(isTransactionConflict(failure), false);
    let calls = 0;
    try {
      await retrySerializable(async () => { calls++; throw failure; });
      assert.fail('The failure must propagate');
    } catch (error) { assert.equal(error, failure); }
    assert.equal(calls, 1);
  }
});

test('exhaustion translates nested adapter conflicts to a bounded availability conflict', async () => {
  for (const attempts of [1, 2, 3]) {
    let calls = 0;
    await assert.rejects(retrySerializable(async () => {
      calls++;
      throw { code: 'P2010', meta: { driverAdapterError: adapterConflict } };
    }, attempts), (error: unknown) => error instanceof AppError && error.statusCode === 409);
    assert.equal(calls, attempts);
  }
});

test('invalid retry budgets reject before invoking the operation', async () => {
  for (const attempts of [0, -1, 4, 1.5, Number.NaN, Infinity]) {
    let calls = 0;
    await assert.rejects(retrySerializable(async () => { calls++; }, attempts), RangeError);
    assert.equal(calls, 0);
  }
});

test('domain conflicts take precedence over serialization replay', async () => {
  for (const marker of ['VISIT_BOOKING_CAPACITY', 'VISIT_BUSINESS_UNPUBLISHED', 'VISIT_CUSTOMER_CONTACT_REQUIRED', 'VISIT_ATTEMPT_REJECTED']) {
    let calls = 0;
    await assert.rejects(retrySerializable(async () => {
      calls++;
      throw { code: 'P2010', meta: { driverAdapterError: adapterConflict, message: marker } };
    }), (error: unknown) => error instanceof AppError && error.statusCode === 409);
    assert.equal(calls, 1);
  }
});

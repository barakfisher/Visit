import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateTimeToInstant, possibleLocalInstants } from '../src/scheduling/local-time.js';

test('spring-forward nonexistent local times are rejected', () => {
  assert.deepEqual(possibleLocalInstants('2026-03-08', '02:30', 'America/New_York'), []);
  assert.throws(() => localDateTimeToInstant('2026-03-08', '02:30', 'America/New_York'), /does not exist/);
});

test('fall-back ambiguous local times require the matching explicit offset', () => {
  const candidates = possibleLocalInstants('2026-11-01', '01:30', 'America/New_York');
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(candidates[1]?.toISOString(), '2026-11-01T06:30:00.000Z');
  assert.throws(() => localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York'), /ambiguous/);
  assert.equal(localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York', '-05:00').toISOString(), '2026-11-01T06:30:00.000Z');
  assert.throws(() => localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York', '-07:00'), /not valid/);
});

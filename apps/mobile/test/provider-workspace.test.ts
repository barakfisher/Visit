import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderWorkspace } from '../src/lib/providerWorkspace';
const a = { id: 'a', name: 'A', timezone: 'Asia/Jerusalem' }, b = { ...a, id: 'b', name: 'B' };
test('provider selectors cannot fall back to another tenant; multiple workspaces require explicit choice', () => {
  assert.deepEqual(resolveProviderWorkspace([], undefined, null), { state: 'denied' });
  assert.deepEqual(resolveProviderWorkspace([a, b], undefined, null), { state: 'choose' });
  assert.deepEqual(resolveProviderWorkspace([a], undefined, null), { state: 'allowed', business: a });
  assert.deepEqual(resolveProviderWorkspace([a, b], undefined, 'b'), { state: 'allowed', business: b });
  assert.deepEqual(resolveProviderWorkspace([a, b], 'a', 'b'), { state: 'allowed', business: a });
  for (const selector of ['', ['a', 'b'], 'foreign', '../a', 'a/extra']) assert.deepEqual(resolveProviderWorkspace([a, b], selector, 'a'), { state: 'denied' });
  assert.deepEqual(resolveProviderWorkspace([b], 'a', 'a'), { state: 'denied' });
});

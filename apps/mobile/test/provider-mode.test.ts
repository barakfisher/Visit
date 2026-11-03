import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderMode, providerModeOnHome } from '../src/lib/ProviderMode';
const managed = (id: string) => ({ role: 'OWNER', status: 'ACTIVE', business: { id, name: id, approvalStatus: 'APPROVED' } });
const saved = { identityId: 'owner', businessId: 'studio' };
test('a remembered provider mode reopens only for the same person while they still manage the business', () => {
  assert.equal(providerModeOnHome(saved, 'owner', [managed('studio')]), 'restore');
  assert.equal(providerModeOnHome(saved, 'owner', [managed('other')]), 'forget', 'access removed');
  assert.equal(providerModeOnHome(saved, 'someone-else', [managed('studio')]), 'forget', 'another account on this device');
  assert.equal(providerModeOnHome(saved, 'owner', null), 'none', 'the account could not be read; keep it for next time');
  assert.equal(providerModeOnHome(null, 'owner', [managed('studio')]), 'none');
  assert.equal(providerModeOnHome(saved, null, [managed('studio')]), 'none');
});
test('only a well-formed entry with both ids is read back', () => {
  assert.deepEqual(parseProviderMode(JSON.stringify(saved)), saved);
  assert.deepEqual(parseProviderMode(JSON.stringify({ ...saved, token: 'never stored' })), saved);
  for (const raw of [null, '', 'not json', '{}', JSON.stringify({ identityId: 'owner' }), JSON.stringify({ identityId: 1, businessId: 'studio' })]) assert.equal(parseProviderMode(raw), null);
});

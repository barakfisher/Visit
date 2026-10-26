import assert from 'node:assert/strict';
import test from 'node:test';
import { invitationToken } from '../src/lib/invitationToken';
const token = 'a'.repeat(43);
test('private invitation accepts only exact scoped fragment URL with one opaque credential', () => {
  assert.equal(invitationToken(`https://visit.test/invite#invite=${token}`, 'https://visit.test'), token);
  assert.equal(invitationToken(`visit://invite#invite=${token}`), token);
  for (const raw of [`https://attacker.test/invite#invite=${token}`, `https://visit.test/p/foo#invite=${token}`, `https://visit.test/invite?invite=${token}`, `https://visit.test/invite#invite=${token}&invite=${token}`, 'https://visit.test/invite#invite=bad', `https://user@visit.test/invite#invite=${token}`, `visit://other#invite=${token}`]) assert.equal(invitationToken(raw, 'https://visit.test'), null);
});

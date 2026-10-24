import assert from 'node:assert/strict';
import test from 'node:test';
import { emailTokenFromUrl, withoutEmailToken } from '../src/lib/emailLinkToken';
const token = 'a'.repeat(43);
test('email callback accepts only expected web/native routes and a single well-formed credential', () => {
  assert.equal(emailTokenFromUrl(`https://visit.example/auth/email#token=${token}`, 'https://visit.example'), token);
  assert.equal(emailTokenFromUrl(`visit://auth/email#token=${token}`), token);
  assert.equal(emailTokenFromUrl(`https://visit.example/auth?token=${token}`, 'https://visit.example'), token);
  for (const url of [`https://evil.test/auth/email#token=${token}`, `https://visit.example/booking#token=${token}`, `visit://foreign/email#token=${token}`, `https://visit.example/auth/email?token=${token}#token=${token}`, 'https://visit.example/auth/email#token=bad', 'garbage']) assert.equal(emailTokenFromUrl(url, 'https://visit.example'), null);
});
test('email credentials are scrubbed from both URL locations, including malformed values', () => {
  const cleaned = new URL(withoutEmailToken(`https://visit.example/auth/email?returnTo=%2Fdiscover&token=private#token=private`));
  assert.equal(cleaned.searchParams.get('returnTo'), '/discover'); assert.equal(cleaned.searchParams.has('token'), false); assert.equal(cleaned.hash, '');
  assert.equal(withoutEmailToken('https://visit.example/auth/email#token=malformed').includes('malformed'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { googleAuthorizationUrl, googleNativeLaunchUrl, parseGoogleCallback, safeGoogleReturnTo } from '../src/lib/googleCallback';
const grant = 'a'.repeat(43), state = 'b'.repeat(43);
test('Google handoff accepts only exact endpoint, unique fragment grant and bound native state', () => {
  const web = 'https://visit.test/auth/google', native = 'visit://auth/google';
  assert.deepEqual(parseGoogleCallback(`${web}#grant=${grant}`, web), { grant });
  assert.deepEqual(parseGoogleCallback(`${native}#grant=${grant}&state=${state}`, native, state), { grant });
  assert.deepEqual(parseGoogleCallback(`${native}#status=cancelled&state=${state}`, native, state), { status: 'cancelled' });
  for (const value of [`https://attacker.test/auth/google#grant=${grant}`, `${web}/#grant=${grant}`, `${web}?grant=${grant}`, `${web}#grant=${grant}&grant=${grant}`, `${web}#grant=${grant}&status=failed`, `${web}#grant=${grant}&state=${state}`, `${web}#grant=bad`, `https://user@visit.test/auth/google#grant=${grant}`, `${web}?next=x#grant=${grant}`]) assert.deepEqual(parseGoogleCallback(value, web), { status: 'invalid' });
  for (const value of [`${native}#grant=${grant}`, `${native}#grant=${grant}&state=${grant}`, `visit://evil/google#grant=${grant}&state=${state}`]) assert.deepEqual(parseGoogleCallback(value, native, state), { status: 'invalid' });
});
test('Google launch destination and navigation hints cannot override broker trust boundaries', () => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&code_challenge_method=S256&code_challenge=${grant}&state=${state}&nonce=${grant}`;
  assert.equal(googleAuthorizationUrl(url), url);
  assert.throws(() => googleAuthorizationUrl(url.replace('accounts.google.com', 'evil.test')));
  assert.throws(() => googleAuthorizationUrl(url.replace('S256', 'plain')));
  const launch = `https://api.visit.test/api/auth/google/authorize?ticket=${grant}`;
  assert.equal(googleNativeLaunchUrl(launch, 'https://api.visit.test'), launch);
  for (const value of [launch.replace('api.visit.test', 'evil.test'), `${launch}&ticket=${state}`, `${launch}&redirect=evil`, `${launch}#other`]) assert.throws(() => googleNativeLaunchUrl(value, 'https://api.visit.test'));
  for (const value of ['/', '/register/provider', '/booking/business-123?date=2026-10-25']) assert.equal(safeGoogleReturnTo(value), value);
  for (const value of ['//evil.test/discover', '/\\evil.test/discover', '/booking/../provider', '/provider/dashboard', '/discover#grant=x', 'https://visit.invalid/discover']) assert.equal(safeGoogleReturnTo(value), undefined);
});

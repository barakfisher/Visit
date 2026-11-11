import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_API_URL, apiAddress } from '../src/lib/apiAddress';

const phone = 'https://host.example.ts.net', local = 'http://localhost:3000';

test('the browser uses its own address when one is set, so a phone and a browser can share one Metro', () => {
  assert.equal(apiAddress('web', { api: phone, web: local }), local);
  assert.equal(apiAddress('ios', { api: phone, web: local }), phone);
  assert.equal(apiAddress('android', { api: phone, web: local }), phone);
});

test('without a browser address every build uses the shared one, as before', () => {
  assert.equal(apiAddress('web', { api: phone }), phone);
  assert.equal(apiAddress('web', { api: phone, web: '' }), phone, 'an empty value counts as unset');
  assert.equal(apiAddress('android', { api: phone }), phone);
});

test('with nothing set, the local development API', () => {
  assert.equal(apiAddress('web', {}), DEFAULT_API_URL);
  assert.equal(apiAddress('ios', { web: local }), DEFAULT_API_URL, 'a browser-only address never reaches a phone');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_CHANNELS, activeContactChannel, contactChannels, offersGoogle } from '../src/lib/AuthCapabilities';

const off = { sms: false, google: false, googleNative: false, email: true };

test('Google is offered only where the server configured it for that platform', () => {
  assert.equal(offersGoogle(off, 'web'), false);
  assert.equal(offersGoogle(off, 'ios'), false);
  assert.equal(offersGoogle({ ...off, google: true }, 'web'), true);
  assert.equal(offersGoogle({ ...off, google: true }, 'android'), false);
  assert.equal(offersGoogle({ ...off, googleNative: true }, 'ios'), true);
});

test('nothing is offered while capabilities load or fail', () => {
  assert.equal(offersGoogle(undefined, 'web'), false);
  assert.deepEqual(contactChannels(undefined), []);
});

test('contact channels follow delivery, in a fixed order', () => {
  assert.deepEqual(contactChannels({ email: true, phone: false }), ['email']);
  assert.deepEqual(contactChannels({ email: false, phone: false }), []);
  assert.deepEqual(contactChannels({ phone: true, email: true }), [...CONTACT_CHANNELS]);
});

test('the form keeps the picked channel and falls back to the first offered one', () => {
  assert.equal(activeContactChannel('phone', ['email', 'phone']), 'phone');
  assert.equal(activeContactChannel('phone', ['email']), 'email');
  assert.equal(activeContactChannel('email', ['phone']), 'phone');
  assert.equal(activeContactChannel('email', []), undefined);
});

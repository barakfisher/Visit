import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/apiClient';
import { passwordFailure, signUpNeedsNewCode, SIGN_UP_CODE_INVALID, SIGN_UP_EXPIRED } from '../src/lib/PasswordSignUp';

const api = (code: string, status: number) => new ApiError('server message', code, status);

test('each sign-up and code failure has its own message', () => {
  assert.equal(passwordFailure(api(SIGN_UP_CODE_INVALID, 400)), 'password.codeInvalid');
  assert.equal(passwordFailure(api(SIGN_UP_EXPIRED, 410)), 'password.codeExpired');
  assert.equal(passwordFailure(api('EMAIL_TAKEN', 409)), 'password.taken');
  assert.equal(passwordFailure(api('ACCOUNT_DELIVERY_UNAVAILABLE', 503)), 'password.deliveryFailed');
  assert.equal(passwordFailure(api('METHOD_NOT_CONFIGURED', 503)), 'password.deliveryFailed');
  assert.equal(passwordFailure(api('VALIDATION_ERROR', 400)), 'password.invalidInput');
  assert.equal(passwordFailure(api('RATE_LIMITED', 429)), 'password.rateLimited');
  assert.equal(passwordFailure(api('INVALID_CREDENTIALS', 401)), 'password.invalid');
  assert.equal(passwordFailure(api('AUTH_TEMPORARILY_UNAVAILABLE', 503)), 'password.unavailable');
  assert.equal(passwordFailure(new Error('offline')), 'password.unavailable');
});

test('only a refused sign-up or a code that ran out needs a new code; a wrong code can be retyped', () => {
  assert.equal(signUpNeedsNewCode(api(SIGN_UP_EXPIRED, 410), 120), true);
  assert.equal(signUpNeedsNewCode(api(SIGN_UP_CODE_INVALID, 400), 0), true);
  assert.equal(signUpNeedsNewCode(api(SIGN_UP_CODE_INVALID, 400), 120), false);
  assert.equal(signUpNeedsNewCode(new Error('offline'), 120), false);
});

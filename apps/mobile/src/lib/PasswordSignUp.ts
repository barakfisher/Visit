import type { MessageKey } from '../i18n/messages';
import { ApiError } from './apiClient';

// Sign-up proves the email with a six-digit code before the account exists (login-plan-stage-2.md, slice 1).
export const SIGN_UP_CODE_INVALID = 'SIGN_UP_CODE_INVALID';
export const SIGN_UP_EXPIRED = 'SIGN_UP_EXPIRED';
export const SIGN_UP_CODE_LENGTH = 6;

/** The message for a failed password sign-in, sign-up or code check. */
export function passwordFailure(reason: unknown): MessageKey {
  if (!(reason instanceof ApiError)) return 'password.unavailable';
  switch (reason.code) {
    case 'INVALID_CREDENTIALS': return 'password.invalid';
    case 'EMAIL_TAKEN': return 'password.taken';
    case 'VALIDATION_ERROR': return 'password.invalidInput';
    case SIGN_UP_CODE_INVALID: return 'password.codeInvalid';
    case SIGN_UP_EXPIRED: return 'password.codeExpired';
    case 'ACCOUNT_DELIVERY_UNAVAILABLE': case 'METHOD_NOT_CONFIGURED': return 'password.deliveryFailed';
  }
  return reason.status === 429 ? 'password.rateLimited' : 'password.unavailable';
}

/** Whether the code step must start over: the server refused this sign-up for good, or its time ran out. */
export function signUpNeedsNewCode(reason: unknown, remainingSeconds: number) {
  return remainingSeconds <= 0 || (reason instanceof ApiError && reason.code === SIGN_UP_EXPIRED);
}

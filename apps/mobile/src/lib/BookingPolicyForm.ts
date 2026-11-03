import type { MessageKey } from '../i18n/messages';
import { ApiError } from './apiClient';

export const MINUTES_PER_HOUR = 60;
/** Fields the owner types in hours; the API stores every cutoff in minutes. */
export const HOUR_FIELDS = ['cancellationCutoffMinutes', 'rescheduleCutoffMinutes'] as const;
export const POLICY_NUMBER_FIELDS = ['minimumNoticeMinutes', 'maximumAdvanceDays', 'bufferBeforeMinutes', 'bufferAfterMinutes', ...HOUR_FIELDS] as const;
export type PolicyNumberField = typeof POLICY_NUMBER_FIELDS[number];
export type PolicyNumbers = Record<PolicyNumberField, number>;
export type PolicyFormValues = Record<PolicyNumberField, string>;
const isHourField = (field: PolicyNumberField) => (HOUR_FIELDS as readonly string[]).includes(field);

/** Whole hours print as integers; a value saved in minutes before this form existed prints as decimal hours. */
export function hoursText(minutes: number) {
  return String(Number((minutes / MINUTES_PER_HOUR).toFixed(2)));
}
export function policyFormValues(policy: PolicyNumbers): PolicyFormValues {
  return Object.fromEntries(POLICY_NUMBER_FIELDS.map(field => [field, isHourField(field) ? hoursText(policy[field]) : String(policy[field])])) as PolicyFormValues;
}
/**
 * Converts typed values back to the API's units, or null when any field is not a whole non-negative number.
 * An untouched non-whole-hour cutoff is sent back as its original minutes, so opening and saving never rounds it.
 */
export function policyNumbers(values: PolicyFormValues, initial: PolicyNumbers): PolicyNumbers | null {
  const result = {} as PolicyNumbers;
  for (const field of POLICY_NUMBER_FIELDS) {
    const text = values[field].trim();
    if (isHourField(field) && text === hoursText(initial[field])) result[field] = initial[field];
    else if (/^\d+$/.test(text)) result[field] = Number(text) * (isHourField(field) ? MINUTES_PER_HOUR : 1);
    else return null;
  }
  return result;
}

type Hint = { key: MessageKey; values: { count: number } } | null;
function countHint(text: string, keys: { none?: MessageKey; one: MessageKey; many: MessageKey }): Hint {
  if (!/^\d+$/.test(text.trim())) return null;
  const count = Number(text);
  return { key: count === 0 && keys.none ? keys.none : count === 1 ? keys.one : keys.many, values: { count } };
}
/** The live sentence under "latest booking before start" and "how far ahead", so the number's direction is explicit. */
export const noticeHint = (text: string) => countHint(text, { none: 'setup.noticeHintNone', one: 'setup.noticeHintOne', many: 'setup.noticeHint' });
export const advanceHint = (text: string) => countHint(text, { one: 'setup.advanceHintOne', many: 'setup.advanceHint' });

/** The server's refusal to save the verified-phone requirement while SMS delivery is off. */
export const VERIFIED_PHONE_UNAVAILABLE = 'VERIFIED_PHONE_UNAVAILABLE';
/**
 * Whether the owner may change "require verified phone", and what to tell them.
 * `sms` is `/api/auth/capabilities`: undefined while loading, false when off or unreadable.
 * A requirement that is already on stays switchable so the owner can always turn it off (decisions.md, 2026-11-03 verified phone).
 */
export function verifiedPhoneSwitch(sms: boolean | undefined, on: boolean): { disabled: boolean; hint: MessageKey | null } {
  if (sms) return { disabled: false, hint: null };
  if (sms === undefined) return { disabled: !on, hint: null };
  return on ? { disabled: false, hint: 'setup.verifiedPhoneOn' } : { disabled: true, hint: 'setup.verifiedPhoneUnavailable' };
}
/** The message for a failed policy save: the verified-phone refusal gets its own, anything else the generic one. */
export function policySaveFailure(error: unknown): MessageKey {
  return error instanceof ApiError && error.code === VERIFIED_PHONE_UNAVAILABLE ? 'setup.verifiedPhoneRefused' : 'setup.saveFailure';
}

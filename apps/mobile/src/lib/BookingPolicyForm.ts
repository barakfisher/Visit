import type { MessageKey } from '../i18n/messages';

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

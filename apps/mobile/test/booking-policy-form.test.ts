import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceHint, HOUR_FIELDS, hoursText, MINUTES_PER_HOUR, noticeHint, policyFormValues, policyNumbers, policySaveFailure, VERIFIED_PHONE_UNAVAILABLE, verifiedPhoneSwitch, type PolicyNumbers } from '../src/lib/BookingPolicyForm';
import { ApiError } from '../src/lib/apiClient';
import { translate } from '../src/i18n/messages';

const saved: PolicyNumbers = { minimumNoticeMinutes: 60, maximumAdvanceDays: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, cancellationCutoffMinutes: 24 * MINUTES_PER_HOUR, rescheduleCutoffMinutes: 2 * MINUTES_PER_HOUR };

test('cutoffs are shown in hours while every other field keeps its stored unit', () => {
  const values = policyFormValues(saved);
  assert.equal(values.cancellationCutoffMinutes, '24');
  assert.equal(values.rescheduleCutoffMinutes, '2');
  assert.equal(values.minimumNoticeMinutes, String(saved.minimumNoticeMinutes));
  assert.equal(values.maximumAdvanceDays, String(saved.maximumAdvanceDays));
});

test('typed hours are sent to the API as minutes', () => {
  const values = { ...policyFormValues(saved), cancellationCutoffMinutes: '48', rescheduleCutoffMinutes: '0' };
  assert.deepEqual(policyNumbers(values, saved), { ...saved, cancellationCutoffMinutes: 48 * MINUTES_PER_HOUR, rescheduleCutoffMinutes: 0 });
});

test('a cutoff saved in minutes that is not whole hours survives an untouched save', () => {
  const legacy = { ...saved, cancellationCutoffMinutes: 90 };
  const values = policyFormValues(legacy);
  assert.equal(values.cancellationCutoffMinutes, hoursText(90));
  assert.equal(values.cancellationCutoffMinutes, '1.5');
  assert.equal(policyNumbers(values, legacy)?.cancellationCutoffMinutes, 90);
});

test('anything but a whole non-negative number is refused', () => {
  for (const field of [...HOUR_FIELDS, 'minimumNoticeMinutes', 'maximumAdvanceDays'] as const) {
    for (const text of ['', '-1', '2.5', 'abc', '1e2']) assert.equal(policyNumbers({ ...policyFormValues(saved), [field]: text }, saved), null, `${field}=${JSON.stringify(text)}`);
  }
});

test('the live sentences say which way each number works, in both languages', () => {
  for (const locale of ['en', 'he'] as const) {
    const many = noticeHint('45')!, none = noticeHint('0')!, one = noticeHint('1')!, ahead = advanceHint('14')!, oneDay = advanceHint('1')!;
    assert.equal(many.key, 'setup.noticeHint'); assert.equal(none.key, 'setup.noticeHintNone'); assert.equal(one.key, 'setup.noticeHintOne');
    assert.equal(ahead.key, 'setup.advanceHint'); assert.equal(oneDay.key, 'setup.advanceHintOne');
    assert.match(translate(locale, many.key, many.values), /45/);
    assert.match(translate(locale, ahead.key, ahead.values), /14/);
    for (const hint of [many, none, one, ahead, oneDay]) assert.doesNotMatch(translate(locale, hint.key, hint.values), /\{count\}/);
  }
  assert.equal(noticeHint(''), null);
  assert.equal(advanceHint('x'), null);
});

test('the verified phone switch is locked while SMS is off unless the requirement is already on', () => {
  assert.deepEqual(verifiedPhoneSwitch(true, false), { disabled: false, hint: null });
  assert.deepEqual(verifiedPhoneSwitch(true, true), { disabled: false, hint: null });
  assert.deepEqual(verifiedPhoneSwitch(false, false), { disabled: true, hint: 'setup.verifiedPhoneUnavailable' });
  assert.deepEqual(verifiedPhoneSwitch(false, true), { disabled: false, hint: 'setup.verifiedPhoneOn' });
});

test('while SMS availability is loading only turning the requirement off is possible', () => {
  assert.deepEqual(verifiedPhoneSwitch(undefined, false), { disabled: true, hint: null });
  assert.deepEqual(verifiedPhoneSwitch(undefined, true), { disabled: false, hint: null });
});

test('the server refusing the verified phone requirement gets its own localized message', () => {
  assert.equal(policySaveFailure(new ApiError('Phone verification is not available yet.', VERIFIED_PHONE_UNAVAILABLE, 409)), 'setup.verifiedPhoneRefused');
  assert.equal(policySaveFailure(new ApiError('Review the fields.', 'VALIDATION_ERROR', 400)), 'setup.saveFailure');
  assert.equal(policySaveFailure(new TypeError('offline')), 'setup.saveFailure');
  assert.equal(translate('he', 'setup.verifiedPhoneRefused'), 'אימות טלפון עדיין לא זמין. יש לכבות את דרישת הטלפון המאומת ולשמור שוב.');
  assert.equal(translate('en', 'setup.verifiedPhoneRefused'), 'Phone verification isn’t available yet. Turn off the verified phone requirement and save again.');
  assert.equal(translate('he', 'setup.verifiedPhoneUnavailable'), 'אימות טלפון עדיין לא זמין, ולכן לקוחות לא יוכלו לעמוד בדרישה הזו.');
  assert.equal(translate('en', 'setup.verifiedPhoneOn'), 'Phone verification isn’t available yet, so no customer can book while this is on. Turn it off and save.');
});

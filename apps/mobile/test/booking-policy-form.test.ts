import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceHint, HOUR_FIELDS, hoursText, MINUTES_PER_HOUR, noticeHint, policyFormValues, policyNumbers, type PolicyNumbers } from '../src/lib/BookingPolicyForm';
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

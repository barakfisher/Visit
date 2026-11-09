import assert from 'node:assert/strict';
import test from 'node:test';
import { translate, type Locale } from '../src/i18n/messages';
import { pluralCategory, translateCount } from '../src/i18n/plural';
import { cancellationCutoffText, MINUTES_PER_HOUR } from '../src/i18n/cancellationCutoff';

const locales: Locale[] = ['he', 'en'];

test('plural categories: Hebrew keeps its dual, English folds two into other', () => {
  assert.equal(pluralCategory('he', 1), 'one');
  assert.equal(pluralCategory('he', 2), 'two');
  assert.equal(pluralCategory('he', 3), 'other');
  assert.equal(pluralCategory('he', 0), 'other');
  assert.equal(pluralCategory('en', 1), 'one');
  assert.equal(pluralCategory('en', 2), 'other');
  assert.equal(pluralCategory('en', 0), 'other');
});

test('plural categories work where the engine has no Intl.PluralRules, as Hermes on a device', t => {
  const real = Intl.PluralRules, engine = Intl as unknown as { PluralRules?: typeof Intl.PluralRules };
  t.after(() => { engine.PluralRules = real; });
  delete engine.PluralRules;
  assert.equal(pluralCategory('he', 2), 'two');
  assert.equal(pluralCategory('en', 1), 'one');
});

test('the plural rules agree with the standard rules for whole numbers', () => {
  for (const [locale, tag] of [['he', 'he-IL'], ['en', 'en-GB']] as const) {
    const standard = new Intl.PluralRules(tag);
    for (let count = 0; count <= 1000; count += 1) {
      const category = standard.select(count);
      assert.equal(pluralCategory(locale, count), category === 'one' || category === 'two' ? category : 'other', `${locale} ${count}`);
    }
  }
});

test('every counted message family has all three forms in both languages', () => {
  for (const base of ['bookingCommit.cancelHours', 'bookingCommit.cancelMinutes'] as const) {
    for (const locale of locales) for (const form of ['one', 'two', 'other'] as const) {
      const key = `${base}.${form}` as const;
      assert.notEqual(translate(locale, key), key, `${locale} ${key}`);
    }
  }
});

test('a cutoff in whole hours reads as hours, never as a large number of minutes', () => {
  const day = 24 * MINUTES_PER_HOUR;
  for (const locale of locales) {
    assert.equal(cancellationCutoffText(locale, day), translate(locale, 'bookingCommit.cancelHours.other', { count: 24 }));
    assert.equal(cancellationCutoffText(locale, MINUTES_PER_HOUR), translate(locale, 'bookingCommit.cancelHours.one', { count: 1 }));
    assert.doesNotMatch(cancellationCutoffText(locale, day), new RegExp(String(day)));
  }
  assert.equal(cancellationCutoffText('he', 2 * MINUTES_PER_HOUR), translate('he', 'bookingCommit.cancelHours.two'));
});

test('a cutoff that is not a whole number of hours, or zero, stays in minutes', () => {
  const ninety = MINUTES_PER_HOUR + MINUTES_PER_HOUR / 2;
  for (const locale of locales) {
    assert.equal(cancellationCutoffText(locale, ninety), translate(locale, 'bookingCommit.cancelMinutes.other', { count: ninety }));
    assert.equal(cancellationCutoffText(locale, 0), translate(locale, 'bookingCommit.cancelMinutes.other', { count: 0 }));
  }
});

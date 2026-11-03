import { translate, type Locale, type MessageKey } from './messages';

/** The plural forms Visit's copy distinguishes. Hebrew has a dual ("שעתיים"); English uses `other` for it. */
export type PluralCategory = 'one' | 'two' | 'other';
/** A message family written as `<base>.one`, `<base>.two` and `<base>.other`. */
export type PluralBase = { [K in MessageKey]: K extends `${infer Base}.other` ? Base : never }[MessageKey];

export function pluralCategory(locale: Locale, count: number): PluralCategory {
  const category = new Intl.PluralRules(locale === 'he' ? 'he-IL' : 'en-GB').select(count);
  return category === 'one' || category === 'two' ? category : 'other';
}

/** Translates the form of `base` that matches `count`; `{count}` is available to every form. */
export function translateCount(locale: Locale, base: PluralBase, count: number, values: Record<string, string | number> = {}) {
  return translate(locale, `${base}.${pluralCategory(locale, count)}` as MessageKey, { count, ...values });
}

import { translate, type Locale, type MessageKey } from './messages';

/** The plural forms Visit's copy distinguishes. Hebrew has a dual ("שעתיים"); English uses `other` for it. */
export type PluralCategory = 'one' | 'two' | 'other';
/** A message family written as `<base>.one`, `<base>.two` and `<base>.other`. */
export type PluralBase = { [K in MessageKey]: K extends `${infer Base}.other` ? Base : never }[MessageKey];

/** Written out because Hermes has no Intl.PluralRules on a device. A new locale adds its rule here. Counts are whole numbers. */
export function pluralCategory(locale: Locale, count: number): PluralCategory {
  if (count === 1) return 'one';
  return locale === 'he' && count === 2 ? 'two' : 'other';
}

/** Translates the form of `base` that matches `count`; `{count}` is available to every form. */
export function translateCount(locale: Locale, base: PluralBase, count: number, values: Record<string, string | number> = {}) {
  return translate(locale, `${base}.${pluralCategory(locale, count)}` as MessageKey, { count, ...values });
}

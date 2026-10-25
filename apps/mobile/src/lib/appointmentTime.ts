import { PILOT_TIMEZONE } from '@visit/contracts';
import { translate, type Locale } from '../i18n/messages';
export const intlLocale = (locale: Locale) => locale === 'he' ? 'he-IL' : 'en-GB';
export function timePolicyNote(timezone: string, locale: Locale) {
  return translate(locale, timezone === PILOT_TIMEZONE ? 'time.israelNote' : 'time.legacyNote', { timezone });
}
export function localDate(timezone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// Israeli fallback repeats one hour. Compare exact instants, never infer a fold
// from a fixed UTC offset or the viewer's device zone.
export function appointmentTime(instant: string, timezone: string, locale: Locale) {
  const date = new Date(instant);
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const label = formatter.format(date);
  const sameClock = (other: Date) => localDate(timezone, other) === localDate(timezone, date) && formatter.format(other) === label;
  const occurrence = sameClock(new Date(+date - 3600000)) ? 'time.second' : sameClock(new Date(+date + 3600000)) ? 'time.first' : undefined;
  return `${label}${occurrence ? ` (${translate(locale, occurrence)})` : ''}`;
}
export function appointmentDate(instant: string, timezone: string, locale: Locale) {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone: timezone }).format(new Date(instant));
}

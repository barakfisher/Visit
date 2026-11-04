import { PILOT_TIMEZONE } from '@visit/contracts';
import { isolateLtr, translate, type Locale } from '../i18n/messages';
export const intlLocale = (locale: Locale) => locale === 'he' ? 'he-IL' : 'en-GB';
/** The pilot zone by its name in the viewer's language; an older business keeps its stored zone as written. */
export function businessTimezoneLabel(timezone: string, locale: Locale) {
  return timezone === PILOT_TIMEZONE ? translate(locale, 'time.israel') : timezone;
}
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
/** "10:00–10:30", or "3 Nov 2026 · 10:00–10:30" with the date; the date repeats only when the end falls on another local day.
 *  Times read left to right in Hebrew too, as in the hours and time blocks lists. */
export function appointmentSpan(startsAt: string, endsAt: string, timezone: string, locale: Locale, withDate: boolean) {
  const start = appointmentTime(startsAt, timezone, locale), end = appointmentTime(endsAt, timezone, locale);
  if (!withDate) return isolateLtr(`${start}–${end}`);
  const startDate = appointmentDate(startsAt, timezone, locale);
  if (localDate(timezone, new Date(startsAt)) === localDate(timezone, new Date(endsAt))) return `${startDate} · ${isolateLtr(`${start}–${end}`)}`;
  return `${startDate} · ${isolateLtr(start)} – ${appointmentDate(endsAt, timezone, locale)} · ${isolateLtr(end)}`;
}
/** "1–7 Nov 2026" for two local calendar dates (YYYY-MM-DD), read at UTC noon so no zone can shift them.
 *  Month and year appear once when both ends share them; without `formatRange` both dates are written out. */
export function dateRange(fromDate: string, toDate: string, locale: Locale) {
  const format = new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const from = new Date(`${fromDate}T12:00:00Z`), to = new Date(`${toDate}T12:00:00Z`);
  if (typeof format.formatRange === 'function') return format.formatRange(from, to);
  return fromDate === toDate ? format.format(from) : `${format.format(from)} – ${format.format(to)}`;
}

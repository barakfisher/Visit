import type { Locale } from '../i18n/messages';
import type { AgendaAppointment, ProviderAgenda } from '../types/ProviderAgenda.types';
import type { CalendarColumn, CalendarEntry } from '../types/BusinessCalendar.types';
import { fullDate, intlLocale } from './appointmentTime';
import { daySegments, gridHours, placeSegments } from './CalendarGrid';

/**
 * The calendar's columns from one agenda read (decisions.md, "The calendar screen" — 2026-11-11). Cancelled
 * appointments are left out, as on the home. An appointment is drawn as ended once it is over or no longer confirmed.
 * Whole-day blocks go to the row above the grid; blocks with hours sit in the grid.
 */
export function calendarColumns(input: { agenda: Pick<ProviderAgenda, 'bookings' | 'blocks' | 'hours'>; dates: readonly string[]; timezone: string; today: string; now: number; locale: Locale }) {
  const { agenda, dates, timezone, today, now, locale } = input;
  const bookings: AgendaAppointment[] = agenda.bookings.filter(booking => booking.status !== 'CANCELLED');
  const timed: { key: string; item: CalendarEntry }[] = [
    ...bookings.map(booking => ({ key: `appointment-${booking.id}`, item: { kind: 'appointment' as const, startsAt: booking.startsAt, endsAt: booking.endsAt, booking, ended: Date.parse(booking.endsAt) <= now || booking.status !== 'CONFIRMED' } })),
    ...agenda.blocks.filter(block => !block.allDay).map(block => ({ key: `block-${block.id}`, item: { kind: 'block' as const, startsAt: block.startsAt, endsAt: block.endsAt, block } })),
  ];
  const segments = daySegments(timed, dates, timezone), placed = placeSegments(segments);
  const weekday = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' });
  const columns: CalendarColumn[] = dates.map(day => ({
    date: day, weekday: weekday.format(new Date(`${day}T12:00:00Z`)), dayOfMonth: String(Number(day.slice(8))), fullDate: fullDate(day, locale),
    today: day === today, hours: agenda.hours.find(entry => entry.date === day),
    entries: placed.filter(piece => piece.date === day),
    allDay: agenda.blocks.filter(block => block.allDay && block.fromDate <= day && day <= block.toDate),
  }));
  return { bookings, columns, grid: gridHours(agenda.hours.filter(entry => dates.includes(entry.date)), segments) };
}

/** "November 2026", or both months when a week crosses one ("November – December 2026"). */
export function calendarMonthTitle(from: string, to: string, locale: Locale) {
  const format = new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(`${from}T12:00:00Z`), last = new Date(`${to}T12:00:00Z`);
  return from.slice(0, 7) === to.slice(0, 7) || typeof format.formatRange !== 'function' ? format.format(first) : format.formatRange(first, last);
}

import type { CalendarCell } from '../types/CompactBooking.types';
import type { Slot } from '../types/flows';
import { localDate } from './appointmentTime';
export function validBookingDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(+value) && value.toISOString().slice(0, 10) === date;
}
export function addBookingDays(date: string, days: number) {
  if (!validBookingDate(date) || !Number.isInteger(days)) throw new RangeError('Choose a valid local date and day count.');
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function shiftBookingMonth(month: string, offset: number) {
  if (!validBookingDate(`${month}-01`) || !Number.isInteger(offset)) throw new RangeError('Choose a valid month.');
  const value = new Date(`${month}-01T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + offset); return value.toISOString().slice(0, 7);
}
export function bookingMonthCells(month: string, availableDates: readonly string[], selectedDate: string, language: string): CalendarCell[] {
  if (!validBookingDate(`${month}-01`)) return [];
  const first = `${month}-01`, leading = new Date(`${first}T12:00:00Z`).getUTCDay();
  const last = new Date(`${first}T12:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const total = last.getUTCDate();
  const available = new Set(availableDates);
  const formatter = new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone: 'UTC' });
  return Array.from({ length: Math.ceil((leading + total) / 7) * 7 }, (_, index) => {
    const day = index - leading + 1;
    if (day < 1 || day > total) return null;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    return { date, day: String(day), label: `${date} · ${formatter.format(new Date(`${date}T12:00:00Z`))}`, available: available.has(date), selected: date === selectedDate };
  });
}
/** How many times the booking screen shows at once; Earlier and Later move by this many. */
export const BOOKING_PAGE_SIZE = 6;
export const bookingSlotId = (slot: Slot) => `${slot.staffId}:${slot.startsAt}`;
export function availableBookingSlots(slots: readonly Slot[], excluded: string | null) {
  return slots.filter(slot => slot.available && !slot.locked && bookingSlotId(slot) !== excluded).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.staffId.localeCompare(b.staffId));
}

/**
 * The day the booking screen opens on, in the business's timezone: the date in the URL when there is one, else the
 * appointment's own day on a reschedule (empty until that appointment has loaded), else today.
 */
export function bookingOpeningDate({ requested, timezone, reschedule, rescheduledStartsAt, now = new Date() }: { requested: string; timezone: string | null; reschedule: boolean; rescheduledStartsAt?: string; now?: Date }) {
  if (validBookingDate(requested)) return requested;
  if (!timezone) return '';
  if (reschedule) return rescheduledStartsAt ? localDate(timezone, new Date(rescheduledStartsAt)) : '';
  return localDate(timezone, now);
}

import { addBookingDays, validBookingDate } from './CompactBooking.utils';
/** Minutes offered by the time picker. Five matches how appointments and free time line up on the business home. */
export const TIME_PICKER_MINUTE_STEP = 5;
export const TIME_PICKER_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
export const TIME_PICKER_MINUTES = Array.from({ length: 60 / TIME_PICKER_MINUTE_STEP }, (_, index) => String(index * TIME_PICKER_MINUTE_STEP).padStart(2, '0'));
/** Every day of `month` (YYYY-MM) from `min` to `max` inclusive; an empty bound is open. */
export function pickableDays(month: string, min: string, max = ''): string[] {
  if (!validBookingDate(`${month}-01`)) return [];
  const days: string[] = [];
  for (let day = `${month}-01`; day.startsWith(month); day = addBookingDays(day, 1)) if ((!min || day >= min) && (!max || day <= max)) days.push(day);
  return days;
}
/** Splits HH:mm into its hour and minute; anything else is empty, so nothing shows as chosen. */
export function timeParts(value: string): { hour: string; minute: string } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: match[1]!, minute: match[2]! } : { hour: '', minute: '' };
}
/** A tap on an hour keeps the chosen minute (00 when none); a tap on a minute keeps the hour (the first hour when none). */
export function pickTime(value: string, patch: { hour?: string; minute?: string }): string {
  const current = timeParts(value);
  return `${patch.hour ?? (current.hour || TIME_PICKER_HOURS[0])}:${patch.minute ?? (current.minute || TIME_PICKER_MINUTES[0])}`;
}

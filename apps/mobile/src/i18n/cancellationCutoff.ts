import type { Locale } from './messages';
import { translateCount } from './plural';

export const MINUTES_PER_HOUR = 60;

/** Owners set the cutoff in hours, so a whole number of hours reads as hours; anything else stays in minutes. */
export function cancellationCutoffText(locale: Locale, minutes: number) {
  return minutes > 0 && minutes % MINUTES_PER_HOUR === 0
    ? translateCount(locale, 'bookingCommit.cancelHours', minutes / MINUTES_PER_HOUR)
    : translateCount(locale, 'bookingCommit.cancelMinutes', minutes);
}

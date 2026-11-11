/**
 * The business home shows today only (decisions.md, "The business home shows today" — 2026-11-10):
 * appointments still to come first, then those that ended today behind a folded row, and no cancelled ones.
 */
type DayAppointment = { status: string; endsAt: string };

/** Ended appointments stay reachable because "Mark no-show" exists only once an appointment is over. */
export function splitAgendaToday<T extends DayAppointment>(bookings: readonly T[], now: number) {
  const upcoming: T[] = [], ended: T[] = [];
  for (const booking of bookings) {
    if (booking.status === 'CANCELLED') continue;
    const endsAt = Date.parse(booking.endsAt);
    (Number.isFinite(endsAt) && endsAt > now && booking.status === 'CONFIRMED' ? upcoming : ended).push(booking);
  }
  return { upcoming, ended };
}

/** The longest the home waits before looking at the clock again, so a new day replaces the old one within this time. */
export const AGENDA_RECHECK_MAX_MS = 15 * 60_000;

/** Milliseconds until the next upcoming appointment ends and moves down to the ended row, at most `AGENDA_RECHECK_MAX_MS`. */
export function nextAgendaRecheck(bookings: readonly DayAppointment[], now: number) {
  const ends = splitAgendaToday(bookings, now).upcoming.map(booking => Date.parse(booking.endsAt) - now);
  return Math.min(AGENDA_RECHECK_MAX_MS, ...ends);
}

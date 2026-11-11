import { Temporal } from '@js-temporal/polyfill';
import type { Interval } from './intervals.js';
import { intersectWindows, resolveWorkingWindows, type LocalWindow } from './availability.js';

/**
 * Free time on one business day, for the business home's "Add appointment" cards
 * (decisions.md, "The business day as cards" — 2026-11-11).
 * A gap is the staff member's working hours minus their appointments (with buffers), holds and blocks, and minus the
 * past. One card per gap, not per slot; a gap shorter than the shortest service the staff member gives is left out.
 */

/** "Now" rounds up to this step, so a gap that is already running starts on a round minute (14:10, not 14:07). */
export const FREE_TIME_STEP_MINUTES = 5;

export type FreeTimeStaff = {
  id: string; displayName: string;
  /** This weekday's own hours; the business's hours when the staff member has none of their own. */
  windows: readonly LocalWindow[];
  /** Appointments' occupied intervals (buffers included), live holds and blocks covering this staff member. */
  busy: readonly Interval[];
  /** Duration plus both buffers of the shortest active service they give; null when they give none. */
  shortestMinutes: number | null;
};
export type FreeGap = { staffId: string; staffName: string; startsAt: Date; endsAt: Date };

/** `from` with every part that `remove` covers taken out; both are half-open [startsAt, endsAt). */
export function subtractIntervals(from: readonly Interval[], remove: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [...from];
  for (const cut of remove) pieces = pieces.flatMap(piece => {
    if (cut.endsAt <= piece.startsAt || cut.startsAt >= piece.endsAt) return [piece];
    const kept: Interval[] = [];
    if (cut.startsAt > piece.startsAt) kept.push({ startsAt: piece.startsAt, endsAt: cut.startsAt });
    if (cut.endsAt < piece.endsAt) kept.push({ startsAt: cut.endsAt, endsAt: piece.endsAt });
    return kept;
  });
  return pieces;
}

/**
 * `closed` means nobody works that day by the weekly hours, which only the hours screen changes; a blocked day is not
 * closed, since releasing the block opens it again. A business with no active staff is closed when it has no hours.
 */
export function dayFreeTime(input: { date: string; timezone: string; now: Date; businessWindows: readonly LocalWindow[]; staff: readonly FreeTimeStaff[] }) {
  const { date, timezone, now } = input;
  const business = resolveWorkingWindows(date, timezone, input.businessWindows).intervals;
  const step = FREE_TIME_STEP_MINUTES * 60_000, past = { startsAt: new Date(0), endsAt: new Date(Math.ceil(now.getTime() / step) * step) };
  let open = input.staff.length === 0 && business.length > 0;
  const free: FreeGap[] = [];
  for (const staff of input.staff) {
    const working = intersectWindows(business, resolveWorkingWindows(date, timezone, staff.windows).intervals);
    if (working.length) open = true;
    if (staff.shortestMinutes === null) continue;
    for (const gap of subtractIntervals(working, [...staff.busy, past]))
      if (gap.endsAt.getTime() - gap.startsAt.getTime() >= staff.shortestMinutes * 60_000) free.push({ staffId: staff.id, staffName: staff.displayName, ...gap });
  }
  free.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId));
  return { closed: !open, free };
}

/** A gap as the client shows it, in the business's local time; `bookLocal` is where a new appointment can start, after the buffer before it. */
export function presentFreeGap(gap: FreeGap, timezone: string, bufferBeforeMinutes: number) {
  const local = (at: Date) => Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timezone).toPlainTime().toString({ smallestUnit: 'minute' });
  return { ...gap, startsAt: gap.startsAt.toISOString(), endsAt: gap.endsAt.toISOString(), startLocal: local(gap.startsAt), endLocal: local(gap.endsAt), bookLocal: local(new Date(gap.startsAt.getTime() + bufferBeforeMinutes * 60_000)) };
}

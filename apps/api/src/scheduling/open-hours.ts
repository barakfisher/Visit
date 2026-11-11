import type { LocalWindow } from './availability.js';

/**
 * When the business is open on each day, in local wall-clock time, for the calendar's grid (decisions.md, "The calendar
 * screen" — 2026-11-11). Open means someone works: the business's hours intersected with each active staff member's
 * own hours (a staff member without hours of their own works the business's), joined. With no active staff, the
 * business's hours. This is the same "closed" the home's day cards use (`dayFreeTime`), read for seven days at once.
 * Blocks do not close a day: releasing a block opens it again.
 */
export type WeekdayWindow = LocalWindow & { weekday: number };
export type DayHours = { date: string; windows: LocalWindow[] };

/** Sorted, overlapping or touching windows joined; HH:mm strings compare in time order. */
export function mergeLocalWindows(windows: readonly LocalWindow[]): LocalWindow[] {
  const merged: LocalWindow[] = [];
  for (const window of [...windows].sort((a, b) => a.startLocal.localeCompare(b.startLocal))) {
    const prior = merged[merged.length - 1];
    if (prior && window.startLocal <= prior.endLocal) merged[merged.length - 1] = { startLocal: prior.startLocal, endLocal: window.endLocal > prior.endLocal ? window.endLocal : prior.endLocal };
    else merged.push({ startLocal: window.startLocal, endLocal: window.endLocal });
  }
  return merged;
}

function intersectLocal(a: readonly LocalWindow[], b: readonly LocalWindow[]) {
  return a.flatMap(x => b.flatMap(y => {
    const startLocal = x.startLocal > y.startLocal ? x.startLocal : y.startLocal, endLocal = x.endLocal < y.endLocal ? x.endLocal : y.endLocal;
    return startLocal < endLocal ? [{ startLocal, endLocal }] : [];
  }));
}

/** `dates` are ISO local dates; weekday 0 is Sunday, as the hours tables store it. */
export function openHours(dates: readonly string[], business: readonly WeekdayWindow[], staff: readonly { windows: readonly WeekdayWindow[] }[]): DayHours[] {
  return dates.map(date => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const ofDay = (windows: readonly WeekdayWindow[]) => windows.filter(window => window.weekday === weekday).map(({ startLocal, endLocal }) => ({ startLocal, endLocal }));
    const businessDay = ofDay(business);
    const windows = staff.length === 0 ? businessDay : staff.flatMap(member => intersectLocal(businessDay, member.windows.length ? ofDay(member.windows) : businessDay));
    return { date, windows: mergeLocalWindows(windows) };
  });
}

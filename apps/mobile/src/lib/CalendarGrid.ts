/**
 * Where things sit on the business calendar's grid (decisions.md, "The calendar screen" — 2026-11-11).
 * Everything is in the business's local wall-clock time: a column is a local date and a row is a local hour, the way a
 * paper diary reads. On a DST day the grid keeps 24 rows; an appointment in the repeated hour is drawn where its clock
 * time says, as Google Calendar does.
 */

export type LocalWindow = { startLocal: string; endLocal: string };
/** When someone works on a day, as the agenda API reads it; no windows means closed. */
export type DayHours = { date: string; windows: LocalWindow[] };
export type CalendarMode = 'week' | 'day';

/** The rows shown when the period has no hours and nothing booked: a working day, so the grid is never empty. */
export const DEFAULT_GRID_HOURS = { start: 8, end: 20 } as const;
/** A tap on an empty part of the grid starts a new appointment at this step (decisions.md, "The calendar screen"). */
export const SLOT_MINUTES = 30;
export const DAY_MINUTES = 24 * 60;

const DAY_MS = 86_400_000;
const parseDate = (date: string) => Date.parse(`${date}T00:00:00Z`);
const formatDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => formatDate(parseDate(date) + days * DAY_MS);
/** 0 is Sunday. */
export const weekday = (date: string) => new Date(parseDate(date)).getUTCDay();
/** Weeks start on Sunday, as the agenda API's `days=7` does. */
export const weekStart = (date: string) => addDays(date, -weekday(date));
export const periodDates = (date: string, mode: CalendarMode) => mode === 'day' ? [date] : Array.from({ length: 7 }, (_, index) => addDays(weekStart(date), index));
/** The next or previous week or day from `date`; a week always lands on its Sunday. */
export const stepPeriod = (date: string, mode: CalendarMode, direction: 1 | -1) => mode === 'day' ? addDays(date, direction) : addDays(weekStart(date), 7 * direction);

export const minutesOf = (local: string) => Number(local.slice(0, 2)) * 60 + Number(local.slice(3, 5));
export const localClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The local date and minute of day of an instant in the business's zone. */
export function localPoint(instant: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(entry => entry.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, minute: Number(part('hour')) * 60 + Number(part('minute')) };
}

export type Segment<T> = { key: string; date: string; startMinute: number; endMinute: number; item: T };

/** An item's piece on each local date it touches, inside `dates`; a piece ending at midnight ends at 24:00, not 00:00 of the next day. */
export function daySegments<T extends { startsAt: string; endsAt: string }>(items: readonly { key: string; item: T }[], dates: readonly string[], timezone: string): Segment<T>[] {
  const shown = new Set(dates), segments: Segment<T>[] = [];
  for (const { key, item } of items) {
    const start = localPoint(item.startsAt, timezone), end = localPoint(item.endsAt, timezone);
    for (let date = start.date; date <= end.date; date = addDays(date, 1)) {
      const startMinute = date === start.date ? start.minute : 0, endMinute = date === end.date ? end.minute : DAY_MINUTES;
      if (shown.has(date) && endMinute > startMinute) segments.push({ key, date, startMinute, endMinute, item });
    }
  }
  return segments;
}

/**
 * The hours the grid shows, whole hours from the earliest opening to the latest closing in the period. Anything booked
 * or blocked outside them widens the range rather than being hidden. A period with neither shows `DEFAULT_GRID_HOURS`.
 */
export function gridHours(hours: readonly DayHours[], segments: readonly { startMinute: number; endMinute: number }[]) {
  const starts = [...hours.flatMap(day => day.windows.map(window => minutesOf(window.startLocal))), ...segments.map(segment => segment.startMinute)];
  const ends = [...hours.flatMap(day => day.windows.map(window => minutesOf(window.endLocal))), ...segments.map(segment => segment.endMinute)];
  if (!starts.length) return { ...DEFAULT_GRID_HOURS };
  return { start: Math.floor(Math.min(...starts) / 60), end: Math.min(24, Math.ceil(Math.max(...ends) / 60)) };
}

export type Placed<T> = Segment<T> & { lane: number; lanes: number };

/**
 * Side by side where they overlap: each piece takes the first lane free at its start, and every piece in a group of
 * overlapping pieces shares that group's lane count, so their widths match.
 */
export function placeSegments<T>(segments: readonly Segment<T>[]): Placed<T>[] {
  const placed: Placed<T>[] = [];
  const byDate = new Map<string, Segment<T>[]>();
  for (const segment of segments) byDate.set(segment.date, [...byDate.get(segment.date) ?? [], segment]);
  for (const daySegments of byDate.values()) {
    const sorted = [...daySegments].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.key.localeCompare(b.key));
    let group: Placed<T>[] = [], laneEnds: number[] = [], groupEnd = -1;
    const closeGroup = () => { for (const piece of group) piece.lanes = laneEnds.length; placed.push(...group); group = []; laneEnds = []; };
    for (const segment of sorted) {
      if (segment.startMinute >= groupEnd) closeGroup();
      let lane = laneEnds.findIndex(end => end <= segment.startMinute);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(segment.endMinute); } else laneEnds[lane] = segment.endMinute;
      group.push({ ...segment, lane, lanes: 0 });
      groupEnd = Math.max(groupEnd, segment.endMinute);
    }
    closeGroup();
  }
  return placed;
}

/** Whether a minute of a day is inside its working hours; outside them the grid is shaded. */
export const isOpen = (day: DayHours | undefined, minute: number) => Boolean(day?.windows.some(window => minutesOf(window.startLocal) <= minute && minute < minutesOf(window.endLocal)));

/** The local start of each empty slot a tap can turn into a new appointment, from the grid's first row to its last. */
export const gridSlots = (hours: { start: number; end: number }) => Array.from({ length: (hours.end - hours.start) * 60 / SLOT_MINUTES }, (_, index) => localClock(hours.start * 60 + index * SLOT_MINUTES));

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

/** A gap with no appointment inside the working hours, as the API computes it (`apps/api/src/scheduling/free-time.ts`). */
export type FreeGap = { staffId: string; staffName: string; startsAt: string; endsAt: string; startLocal: string; endLocal: string; bookLocal: string };
type Dated = { startsAt: string; endsAt: string };

/** One card on today's list: an appointment still to come, free time to book, or a block (decisions.md, "The business day as cards"). */
export type AgendaItem<T, B> = { kind: 'appointment'; at: number; item: T } | { kind: 'free'; at: number; item: FreeGap } | { kind: 'block'; at: number; item: B };

/**
 * Today's cards in time order. Blocks already over drop out, as appointments that ended move to their own row.
 * At the same minute a block comes before free time and free time before an appointment, so a whole-day block leads.
 */
export function agendaTimeline<T extends Dated, B extends Dated>(upcoming: readonly T[], free: readonly FreeGap[], blocks: readonly B[], now: number): AgendaItem<T, B>[] {
  const order = { block: 0, free: 1, appointment: 2 } as const;
  const items: AgendaItem<T, B>[] = [
    ...blocks.filter(block => Date.parse(block.endsAt) > now).map(item => ({ kind: 'block' as const, at: Date.parse(item.startsAt), item })),
    ...free.map(item => ({ kind: 'free' as const, at: Date.parse(item.startsAt), item })),
    ...upcoming.map(item => ({ kind: 'appointment' as const, at: Date.parse(item.startsAt), item })),
  ];
  return items.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

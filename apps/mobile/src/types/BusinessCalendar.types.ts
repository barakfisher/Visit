import type { Locale } from '../i18n/messages';
import type { CalendarMode, DayHours, Placed } from '../lib/CalendarGrid';
import type { BlockRemovalState, TimeBlockDialogState } from '../lib/TimeBlocks.hook';
import type { ManualBookingView } from './ManualBooking.types';
import type { AgendaAppointment, ProviderAgendaView } from './ProviderAgenda.types';
import type { TimeBlock } from './TimeBlocks.types';

/** One thing drawn on the grid: an appointment or a block with hours. Whole-day blocks sit above the grid instead. */
export type CalendarEntry = { kind: 'appointment'; startsAt: string; endsAt: string; booking: AgendaAppointment; ended: boolean } | { kind: 'block'; startsAt: string; endsAt: string; block: TimeBlock };
export type CalendarColumn = {
  date: string;
  /** "Sun", "יום א׳", and the day of the month. */
  weekday: string; dayOfMonth: string; fullDate: string;
  today: boolean; hours: DayHours | undefined;
  entries: Placed<CalendarEntry>[];
  /** Whole-day blocks covering this date. */
  allDay: TimeBlock[];
};

export type BusinessCalendarView = {
  t: ProviderAgendaView['t']; locale: Locale;
  mode: CalendarMode; setMode: (mode: CalendarMode) => void;
  /** The month (or two months) and the dates of the period, for the header. */
  monthTitle: string; rangeTitle: string;
  previous: () => void; next: () => void; goToday: () => void; showsToday: boolean;
  openDay: (date: string) => void;
  /** While `loading`, the period's dates are drawn on an empty grid of the previous period's hours, and nothing in it can be tapped. */
  status: 'loading' | 'error' | 'ready'; retry: () => void;
  columns: CalendarColumn[]; grid: { start: number; end: number };
  /** Today and the minute of day in the business's zone: the "now" line, and slots before it cannot start an appointment. */
  clock: { today: string; minute: number };
  /** A tapped slot asks what to start there; `slot` is the one asked about, or null when no choice is open. */
  chooseSlot: (date: string, localTime: string) => void; closeSlot: () => void;
  slot: { date: string; localTime: string; title: string } | null;
  /** From the slot's choice: Add appointment, or Block time, at that date and time. */
  addAtSlot: () => void; blockAtSlot: () => void;
  blockDialog: TimeBlockDialogState; staff: readonly { id: string; displayName: string }[];
  /** A horizontal swipe on the grid, in its own pixels; it follows the finger until it is let go. */
  swipe: { direction: 'ltr' | 'rtl'; onStart: () => void; onEnd: (translationX: number, velocityX: number) => void };
  /** The appointment or block whose sheet is open. */
  openEntry: (entry: CalendarEntry) => void; closeEntry: () => void;
  openAppointment: AgendaAppointment | null; openBlock: TimeBlock | null;
  businessId: string; timezone: string;
  contact: ProviderAgendaView['contact'];
  blockRemoval: Omit<BlockRemovalState, 'removeFailure'>; feedback: string;
  manual: ManualBookingView;
  /** An appointment's date and times for its sheet, "11 Nov 2026 · 10:00–10:30". */
  span: (startsAt: string, endsAt: string) => string;
};

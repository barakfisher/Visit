import type { Locale } from '../i18n/messages';
import type { CalendarMode, DayHours, Placed } from '../lib/CalendarGrid';
import type { BlockRemovalState } from '../lib/TimeBlocks.hook';
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
  status: 'loading' | 'error' | 'ready'; retry: () => void;
  columns: CalendarColumn[]; grid: { start: number; end: number };
  /** Today and the minute of day in the business's zone: the "now" line, and slots before it cannot start an appointment. */
  clock: { today: string; minute: number };
  empty: boolean;
  /** Opens Add appointment on this calendar at a slot's date and time. */
  addAt: (date: string, localTime: string) => void;
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

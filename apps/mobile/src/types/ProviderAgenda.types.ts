import type { AppointmentStatus } from './AppointmentLifecycle.types';
import type { AuthProfile } from './flows';
import type { MessageKey } from '../i18n/messages';
import type { TimeBlock } from './TimeBlocks.types';
import type { AgendaItem, FreeGap } from '../lib/AgendaToday.utils';
import type { BlockRemovalState, TimeBlockDialogState } from '../lib/TimeBlocks.hook';
import type { ManualBookingView } from './ManualBooking.types';
export type ProviderAgenda = {
  business: { id: string; name: string; timezone: string }; fromDate: string; toDate: string;
  summary: { appointments: number; revenue: Record<string, number> }; staff: { id: string; displayName: string; parallelCapacity: number }[];
  bookings: { source?: string; manualReason?: string | null; id: string; status: AppointmentStatus; canMarkNoShow?: boolean; revision: number; startsAt: string; endsAt: string; customer: { displayName: string | null; phone: string | null; email: string | null }; service: { name: string }; staff: { displayName: string } }[];
  blocks: TimeBlock[];
  /** Today's free time and whether the business is closed by its weekly hours; null for a week. */
  day?: { closed: boolean; free: FreeGap[] } | null;
};
/** `savedDate` is the day of an appointment just saved on the Add appointment screen, for the home to confirm on return. */
export type AgendaDraft = { savedDate: string };
export type AgendaAppointment = ProviderAgenda['bookings'][number];
export type ProviderAgendaView = {
  business: { id: string; name: string; timezone: string }; profile: AuthProfile | null;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  /** Today in the business's timezone; the home has no other day. */
  day: string; agenda: { data: ProviderAgenda | undefined; isError: boolean; isLoading: boolean };
  /** Today's appointments still to come, and those that ended today; cancelled ones are in neither. */
  upcoming: AgendaAppointment[]; ended: AgendaAppointment[];
  /** Today's cards in time order: appointments still to come, free time and blocks not yet over. */
  timeline: AgendaItem<AgendaAppointment, TimeBlock>[]; closed: boolean;
  /** Opens Add appointment on today's date at the gap's first bookable time. */
  addAt: (gap: FreeGap) => void; openHours: () => void;
  busy: boolean; feedback: string; notice: string;
  selectBusiness: (id: string) => void; retry: () => void;
  span: (startsAt: string, endsAt: string) => string; blockDialog: TimeBlockDialogState; blockRemoval: BlockRemovalState; manual: ManualBookingView; contact: (phone: string | null, mode: 'call' | 'whatsapp') => void;
};

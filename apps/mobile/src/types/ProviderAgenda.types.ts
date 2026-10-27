import type { ManualBookingView } from './ManualBooking.types';
import type { AppointmentStatus } from './AppointmentLifecycle.types';
import type { AuthProfile } from './flows';
import type { MessageKey } from '../i18n/messages';
export type ProviderAgenda = {
  business: { id: string; name: string; timezone: string }; fromDate: string; toDate: string;
  summary: { appointments: number; revenue: Record<string, number> }; staff: { id: string; displayName: string; parallelCapacity: number }[];
  bookings: { source?: string; manualReason?: string | null; id: string; status: AppointmentStatus; revision: number; startsAt: string; endsAt: string; customer: { displayName: string | null; phone: string | null; email: string | null }; service: { name: string }; staff: { displayName: string } }[];
  blocks: { id: string; startsAt: string; endsAt: string; reason: string | null; staff: { displayName: string } }[];
};
export type AgendaDraft = { tab: 'agenda' | 'services' | 'hours'; date: string; mode: 'day' | 'week'; blockOpen: boolean; staffId: string; from: string; to: string; reason: string };
export type AgendaBlockInput = { businessId: string; staffId: string; date: string; startLocal: string; endLocal: string; reason: string };
export type ProviderAgendaView = {
  manual: ManualBookingView;
  business: { id: string; name: string; timezone: string }; profile: AuthProfile | null;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  day: string; validDate: boolean; draft: Readonly<AgendaDraft>; agenda: { data: ProviderAgenda | undefined; isError: boolean; isLoading: boolean };
  busy: boolean; feedback: string; timeNote: string; update: (patch: Partial<AgendaDraft>) => void;
  selectBusiness: (id: string) => void; previous: () => void; next: () => void; retry: () => void;
  when: (instant: string) => string; block: () => void; removeBlock: (id: string) => void; contact: (phone: string | null, mode: 'call' | 'whatsapp') => void;
};

import type { AppointmentStatus } from './AppointmentLifecycle.types';
import type { AuthProfile } from './flows';
import type { MessageKey } from '../i18n/messages';
import type { TimeBlock } from './TimeBlocks.types';
import type { BlockRemovalState, TimeBlockDialogState } from '../lib/TimeBlocks.hook';
export type ProviderAgenda = {
  business: { id: string; name: string; timezone: string }; fromDate: string; toDate: string;
  summary: { appointments: number; revenue: Record<string, number> }; staff: { id: string; displayName: string; parallelCapacity: number }[];
  bookings: { source?: string; manualReason?: string | null; id: string; status: AppointmentStatus; canMarkNoShow?: boolean; revision: number; startsAt: string; endsAt: string; customer: { displayName: string | null; phone: string | null; email: string | null }; service: { name: string }; staff: { displayName: string } }[];
  blocks: TimeBlock[];
};
export type AgendaDraft = { date: string; mode: 'day' | 'week' };
export type ProviderAgendaView = {
  business: { id: string; name: string; timezone: string }; profile: AuthProfile | null;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  day: string; validDate: boolean; draft: Readonly<AgendaDraft>; agenda: { data: ProviderAgenda | undefined; isError: boolean; isLoading: boolean };
  busy: boolean; feedback: string; update: (patch: Partial<AgendaDraft>) => void;
  selectBusiness: (id: string) => void; previous: () => void; next: () => void; retry: () => void;
  span: (startsAt: string, endsAt: string) => string; range: (fromDate: string, toDate: string) => string; blockDialog: TimeBlockDialogState; blockRemoval: BlockRemovalState; contact: (phone: string | null, mode: 'call' | 'whatsapp') => void;
};

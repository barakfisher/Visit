import type { Locale } from '../i18n/messages';
import type { useAppLocale } from '../i18n/LocaleContext';
import type { HistoricalAppointment } from './AppointmentLifecycle.types';

export type PastAppointmentsPage = { bookings: HistoricalAppointment[]; nextCursor: string | null };
/** One past appointment as its card shows it; `booking` is for the change history the route adds. */
export type PastAppointmentItem = { id: string; service: string; place: string; when: string; details: string; status: string; booking: HistoricalAppointment };
export type PastAppointmentsView = {
  t: ReturnType<typeof useAppLocale>['t']; locale: Locale;
  bootstrapping: boolean; signedOut: boolean;
  /** The first page: everything else waits on it. */
  state: 'loading' | 'error' | 'ready';
  appointments: PastAppointmentItem[];
  hasMore: boolean; loadingMore: boolean; moreFailed: boolean;
  filter: { name: string; onClear: () => void } | null;
  onMore: () => void; onRetry: () => void; onOpen: (id: string) => void; onBack: () => void;
};

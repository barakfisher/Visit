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
  /** Opened from one business, the list is that business's only; the footer's My appointments is the way back to all of them. */
  filter: { name: string } | null;
  onMore: () => void; onRetry: () => void; onBack: () => void;
};

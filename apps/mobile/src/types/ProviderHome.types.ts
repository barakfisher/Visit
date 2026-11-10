import type { useAppLocale } from '../i18n/LocaleContext';
import type { ProviderContacts } from '../lib/ProviderHome';

export type ProviderHomePanel = 'contact' | 'about';
export type ProviderHomeNext = {
  id: string; when: string; what: string; note: string; error: string; busy: boolean;
  onOpen: () => void; onReschedule?: () => void; onCancel?: () => void;
};
export type ProviderHomeView = {
  t: ReturnType<typeof useAppLocale>['t'];
  state: 'loading' | 'error' | 'unavailable' | 'ready'; onRetry: () => void;
  name: string; listing: string;
  /** Hidden for a visitor who is not signed in: their appointments are not readable. */
  appointmentsState: 'hidden' | 'loading' | 'error' | 'ready'; onRetryAppointments: () => void;
  next: ProviderHomeNext | null; mineSummary: string;
  onBook: () => void; onMine: () => void;
  contacts: ProviderContacts | null; contactSummary: string; onCall: () => void; onWrite: () => void;
  description: string; services: { id: string; name: string; summary: string }[]; hours: { days: string; hours: string }[];
  panel: ProviderHomePanel | null; onPanel: (panel: ProviderHomePanel) => void;
};

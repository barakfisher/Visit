import type { useAppLocale } from '../i18n/LocaleContext';
import type { SavedProviderItem } from './SavedProvider.types';
import type { UpcomingAppointmentView } from './UpcomingAppointment.types';
export type SavedProviderPage = { providers: SavedProviderItem[]; nextCursor: string | null };
export type HomeView = {
  t: ReturnType<typeof useAppLocale>['t']; identity: string | null; bootstrapping: boolean; upcoming: UpcomingAppointmentView;
  providersState: 'loading' | 'error' | 'ready'; providers: SavedProviderItem[]; hasMore: boolean; loadingMore: boolean; removingId: string | null; removeError: boolean;
  onAppointments: () => void; onRetryProviders: () => void; onMore: () => void; onBook: (businessId: string) => void; onRemove: (businessId: string) => void;
};

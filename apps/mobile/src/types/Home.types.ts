import type { useAppLocale } from '../i18n/LocaleContext';
import type { SavedProviderItem } from './SavedProvider.types';
import type { UpcomingAppointmentView } from './UpcomingAppointment.types';
export type SavedProviderPage = { providers: SavedProviderItem[]; nextCursor: string | null };
/** A business the signed-in person owns or manages, shown on customer Home as the way into provider mode. */
export type ManagedBusinessItem = { id: string; name: string; published: boolean };
export type HomeView = {
  t: ReturnType<typeof useAppLocale>['t']; identity: string | null; bootstrapping: boolean; upcoming: UpcomingAppointmentView;
  providersState: 'loading' | 'error' | 'ready'; providers: SavedProviderItem[]; hasMore: boolean; loadingMore: boolean; removingId: string | null; removeError: boolean;
  /** Empty while the account loads or fails; the menu still offers provider mode then. */
  businesses: ManagedBusinessItem[]; openingBusiness: string | null; businessError: 'nav.changed' | 'home.business.failure' | null; onManage: (businessId: string) => void;
  onAppointments: () => void; onRetryProviders: () => void; onMore: () => void; onBook: (businessId: string) => void; onRemove: (businessId: string) => void;
};

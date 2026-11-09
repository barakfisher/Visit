import type { useAppLocale } from '../i18n/LocaleContext';
import type { SavedProviderItem } from './SavedProvider.types';
import type { UpcomingAppointmentView } from './UpcomingAppointment.types';
export type SavedProviderPage = { providers: SavedProviderItem[]; nextCursor: string | null };
/** A business the signed-in person owns or manages. Customer Home shows the ones that still need setup. */
export type ManagedBusinessItem = { id: string; name: string; published: boolean };
export type HomeView = {
  t: ReturnType<typeof useAppLocale>['t']; identity: string | null; bootstrapping: boolean; upcoming: UpcomingAppointmentView;
  providersState: 'loading' | 'error' | 'ready'; providers: SavedProviderItem[]; hasMore: boolean; loadingMore: boolean; removingId: string | null; removeError: boolean; hasArchive: boolean;
  /** The provider awaiting confirmation in the removal dialog; null while it is closed. */
  removeName: string | null;
  /** Empty while the account loads or fails; the header's switch may still offer provider mode then. */
  businesses: ManagedBusinessItem[]; openingBusiness: string | null; businessError: 'nav.changed' | 'home.business.failure' | null; onManage: (businessId: string) => void;
  onRetryProviders: () => void; onMore: () => void; onBook: (businessId: string) => void; onRemove: (businessId: string) => void; onConfirmRemove: () => void; onCancelRemove: () => void; onArchive: () => void;
};

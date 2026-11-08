import type { useAppLocale } from '../i18n/LocaleContext';
import type { SavedProviderItem } from './SavedProvider.types';
export type ArchivedProvidersView = {
  t: ReturnType<typeof useAppLocale>['t']; bootstrapping: boolean; signedOut: boolean; state: 'loading' | 'error' | 'ready'; providers: SavedProviderItem[];
  hasMore: boolean; loadingMore: boolean; restoringId: string | null; restoreError: boolean;
  onRestore: (businessId: string) => void; onRetry: () => void; onMore: () => void; onBack: () => void;
};

import type { useAppLocale } from '../i18n/LocaleContext';
export interface NavigationViewProps {
  t: ReturnType<typeof useAppLocale>['t'];
  direction: 'rtl' | 'ltr';
  providerMode: boolean;
  /** Only for someone who manages an approved business, or who is in provider mode now. */
  canSwitchMode: boolean;
  busy: boolean;
  error: string;
  bellLabel: string;
  /** What the circle says; null when nothing is unread, or when the count could not be read. */
  bellBadge: string | null;
  onAccount: () => void;
  onNotifications: () => void;
  onSwitchMode: () => void;
}

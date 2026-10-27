import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import type { useAppLocale } from '../i18n/LocaleContext';
import type { AccountNavigation } from '../lib/navigation';
export interface NavigationViewProps {
  t: ReturnType<typeof useAppLocale>['t'];
  direction: 'rtl' | 'ltr';
  trigger: RefObject<ComponentRef<typeof View> | null>;
  open: boolean;
  providerMode: boolean;
  loading: boolean;
  failed: boolean;
  managed: AccountNavigation['memberships'];
  applicationStatus: boolean;
  becomeProvider: boolean;
  choosingBusiness: boolean;
  busy: boolean;
  error: string;
  close: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onHome: () => void;
  onAccount: () => void;
  onApplication: () => void;
  onSwitchMode: () => void;
  onBusiness: (id: string) => void;
  onLogout: () => void;
}

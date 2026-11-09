import { useRef, useState } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';
import { apiRequest } from '@/src/lib/api';
import { forgetProviderMode, openProviderWorkspace } from '@/src/lib/ProviderMode.service';
import { readUnreadCount } from '@/src/lib/Notifications.service';
import { bellLabel, circleText, unreadKey } from '@/src/lib/Notifications.utils';
import { accountBusiness, isProviderPath, menuCapabilities, type AccountNavigation } from '@/src/lib/navigation';
import type { NavigationViewProps } from '@/src/types/NavigationView.types';

export function useAppNavigation(): NavigationViewProps | null {
  const { t, direction, locale } = useAppLocale();
  const pathname = usePathname(), identity = useSessionStore(s => s.identityId);
  const selectBusiness = useSessionStore(s => s.selectBusiness), active = useSessionStore(s => s.activeBusinessId);
  const params = useGlobalSearchParams<{ businessId?: string }>(), onAccount = accountBusiness(pathname, params.businessId, useSessionStore(s => s.profile?.businesses));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const account = useQuery({ queryKey: ['me', identity], queryFn: () => apiRequest<AccountNavigation>('/v1/me'), enabled: !!identity, staleTime: 0 });
  const unreadCount = useQuery({ queryKey: unreadKey(identity), queryFn: ({ signal }) => readUnreadCount(signal), enabled: !!identity, staleTime: 0 });
  const unread = unreadCount.isError ? 0 : unreadCount.data?.unread ?? 0;
  const { managed } = menuCapabilities(account.isError ? undefined : account.data);
  const providerMode = !!onAccount || isProviderPath(pathname);
  const modeBusiness = onAccount ?? (providerMode ? active : null);
  const switching = useRef(false);
  async function openBusiness(businessId: string) {
    if (switching.current) return;
    switching.current = true; setBusy(true); setError('');
    try { if (!await openProviderWorkspace(businessId)) { setError(t('nav.changed')); void account.refetch(); } }
    catch { setError(t('nav.changed')); }
    finally { switching.current = false; setBusy(false); }
  }
  function switchMode() {
    // Forget before Home mounts, or Home would reopen the business it just left.
    if (providerMode) { selectBusiness(null); void forgetProviderMode().then(() => router.dismissTo('/')); }
    else if (managed.length === 1) void openBusiness(managed[0]!.business.id);
    // With several businesses the workspace itself asks which one; a business left selected would skip the question.
    else { selectBusiness(null); router.push('/provider/dashboard'); }
  }
  if (!identity || pathname.startsWith('/auth')) return null;
  return { t, direction, providerMode, canSwitchMode: providerMode || managed.length > 0, busy, error, bellLabel: bellLabel(locale, unread), bellBadge: circleText(unreadCount.data?.unread, unreadCount.isError),
    onAccount: () => router.navigate(modeBusiness ? { pathname: '/account', params: { businessId: modeBusiness } } : '/account'),
    onNotifications: () => router.navigate(modeBusiness ? { pathname: '/notifications', params: { businessId: modeBusiness } } : '/notifications'), onSwitchMode: switchMode };
}

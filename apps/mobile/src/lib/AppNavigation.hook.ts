import { useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';
import { apiRequest } from '@/src/lib/api';
import { signOut } from '@/src/lib/auth';
import { forgetProviderMode, openProviderWorkspace } from '@/src/lib/ProviderMode.service';
import { menuCapabilities, type AccountNavigation } from '@/src/lib/navigation';

export function useAppNavigation() {
  const { t, direction } = useAppLocale();
  const pathname = usePathname(), identity = useSessionStore(s => s.identityId);
  const selectBusiness = useSessionStore(s => s.selectBusiness), activeBusiness = useSessionStore(s => s.activeBusinessId);
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState(false), [choosingBusiness, setChoosingBusiness] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const account = useQuery({ queryKey: ['me', identity], queryFn: () => apiRequest<AccountNavigation>('/v1/me'), enabled: !!identity, staleTime: 0 });
  const { managed, applicationStatus, becomeProvider, reviewApplications } = menuCapabilities(account.isError ? undefined : account.data);
  const providerMode = pathname.startsWith('/provider/');
  function close() { setOpen(false); setChoosingBusiness(false); }
  function go(href: Href) { close(); router.push(href); }
  const switching = useRef(false);
  async function provider(businessId: string) {
    if (switching.current || busy || !managed.some(m => m.business.id === businessId)) return;
    switching.current = true; setBusy(true); setError('');
    try {
      if (await openProviderWorkspace(businessId)) close(); else { setError(t('nav.changed')); void account.refetch(); }
    } catch { setError(t('nav.changed')); } finally { switching.current = false; setBusy(false); }
  }
  function switchMode() {
    // Forget before Home mounts, or Home would reopen the business it just left.
    if (providerMode) { selectBusiness(null); close(); void forgetProviderMode().then(() => router.replace('/')); }
    else if (managed.length === 1) void provider(managed[0]!.business.id);
    else setChoosingBusiness(true);
  }
  async function logout() {
    if (busy) return; setBusy(true); setError('');
    try { await signOut(); close(); } catch { setError(t('account.signOutFailed')); } finally { setBusy(false); }
  }
  if (!identity || pathname.startsWith('/auth')) return null;
  return { t, direction, trigger, open, providerMode, loading: account.isFetching && !account.data,
    failed: account.isError, managed, applicationStatus, becomeProvider, choosingBusiness, busy, error,
    close, onOpen: () => { setError(''); setOpen(true); void account.refetch(); },
    // Business settings and team access live in the provider menu (decisions.md, 2026-11-01 and 2026-11-02).
    ...(providerMode && activeBusiness ? { onSettings: () => go({ pathname: '/provider/[businessId]', params: { businessId: activeBusiness } }), onTeam: () => go({ pathname: '/provider/team/[businessId]', params: { businessId: activeBusiness } }) } : {}),
    // In provider mode Home is the business's agenda; leaving provider mode is its own menu item.
    onRetry: () => void account.refetch(), onHome: () => go(providerMode && activeBusiness ? { pathname: '/provider/dashboard', params: { businessId: activeBusiness } } : '/'), onAccount: () => go('/account'),
    onApplication: () => go('/register/provider'), onSwitchMode: switchMode,
    ...(reviewApplications ? { onReview: () => go('/admin/applications') } : {}),
    onBusiness: (id: string) => void provider(id), onLogout: () => void logout() };
}

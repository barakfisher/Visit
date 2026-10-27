import { useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';
import { apiRequest } from '@/src/lib/api';
import type { AuthProfile } from '@/src/types/flows';
import { signOut } from '@/src/lib/auth';
import { menuCapabilities, type AccountNavigation } from '@/src/lib/navigation';

export function useAppNavigation() {
  const { t, direction } = useAppLocale();
  const pathname = usePathname(), identity = useSessionStore(s => s.identityId);
  const selectBusiness = useSessionStore(s => s.selectBusiness);
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState(false), [choosingBusiness, setChoosingBusiness] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const account = useQuery({ queryKey: ['me', identity], queryFn: () => apiRequest<AccountNavigation>('/v1/me'), enabled: !!identity, staleTime: 0 });
  const { managed, applicationStatus, becomeProvider } = menuCapabilities(account.isError ? undefined : account.data);
  const providerMode = pathname.startsWith('/provider/');
  function close() { setOpen(false); setChoosingBusiness(false); }
  function go(href: Href) { close(); router.push(href); }
  const switching = useRef(false);
  async function provider(businessId: string) {
    if (switching.current || busy || !managed.some(m => m.business.id === businessId)) return;
    switching.current = true; setBusy(true); setError('');
    const expected = identity;
    try {
      const { profile } = await apiRequest<{ profile: AuthProfile }>('/api/auth/me');
      const state = useSessionStore.getState();
      if (profile.id !== expected || state.identityId !== expected || !profile.businesses.some(b => b.id === businessId)) { setError(t('nav.changed')); void account.refetch(); return; }
      state.setAuth(state.token, profile);
      selectBusiness(businessId); close(); router.replace({ pathname: '/provider/dashboard', params: { businessId } });
    } catch { setError(t('nav.changed')); } finally { switching.current = false; setBusy(false); }
  }
  function switchMode() {
    if (providerMode) { selectBusiness(null); close(); router.replace('/'); }
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
    onRetry: () => void account.refetch(), onHome: () => go('/'), onAccount: () => go('/account'),
    onApplication: () => go('/register/provider'), onSwitchMode: switchMode,
    onBusiness: (id: string) => void provider(id), onLogout: () => void logout() };
}

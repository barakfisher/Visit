import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link, router, useGlobalSearchParams, useIsFocused, usePathname } from 'expo-router';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { SessionLoading } from './SessionLoading';
import { apiRequest } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import type { AuthProfile } from '@/src/types/flows';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { resolveProviderWorkspace, type ManagedBusiness } from '@/src/lib/providerWorkspace';
const Workspace = createContext<ManagedBusiness | null>(null);
export function useProviderWorkspace() { const value = useContext(Workspace); if (!value) throw new Error('Provider workspace requires current authorization.'); return value; }
export function ProviderAccess({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return focused ? <FocusedProviderAccess>{children}</FocusedProviderAccess> : null;
}
function FocusedProviderAccess({ children }: { children: ReactNode }) {
  const { t } = useAppLocale();
  const identity = useSessionStore(s => s.identityId), bootstrap = useSessionStore(s => s.bootstrapStatus), version = useSessionStore(s => s.contextVersion), active = useSessionStore(s => s.activeBusinessId);
  const currentProfile = useSessionStore(s => s.profile);
  const pathname = usePathname(), params = useGlobalSearchParams<{ businessId?: string | string[] }>();
  const profile = useQuery({ queryKey: ['provider-access', identity, version, pathname, params.businessId], queryFn: () => apiRequest<{ profile: AuthProfile }>('/api/auth/me'), enabled: !!identity && bootstrap === 'ready', retry: false, refetchInterval: 15000 });
  const authorized = profile.data?.profile.id === identity ? profile.data.profile : undefined;
  const selection = resolveProviderWorkspace(authorized?.businesses ?? [], params.businessId, active);
  useEffect(() => {
    if (!authorized) return;
    const state = useSessionStore.getState();
    state.setAuth(state.token, authorized);
  }, [authorized]);
  const allowedId = selection.state === 'allowed' ? selection.business.id : null;
  useEffect(() => {
    if (allowedId && authorized && useSessionStore.getState().profile?.businesses.some(b => b.id === allowedId)) useSessionStore.getState().selectBusiness(allowedId);
  }, [allowedId, authorized]);
  const loginReturn = pathname === '/provider/dashboard' && typeof params.businessId === 'string' ? `${pathname}?${new URLSearchParams({ businessId: params.businessId })}` : pathname;
  if (bootstrap !== 'ready') return <SessionLoading />;
  if (!identity) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText>{t('dashboard.denied')}</AppText><Link href={{ pathname: '/auth/login', params: { returnTo: loginReturn } }}>{t('common.signIn')}</Link><Link href="/">{t('nav.home')}</Link></View>;
  if (profile.isError) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="alert">{t('account.failure')}</AppText><ActionButton label={t('common.retry')} onPress={() => void profile.refetch()} /><Link href="/account">{t('nav.account')}</Link></View>;
  if (!authorized) return <SessionLoading />;
  if (selection.state === 'choose') return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="header" className="text-2xl font-bold">{t('nav.chooseBusiness')}</AppText>{authorized.businesses.map(b => <ActionButton key={b.id} label={b.name} onPress={() => router.replace({ pathname: '/provider/dashboard', params: { businessId: b.id } })} />)}<Link href="/">{t('nav.home')}</Link></View>;
  if (selection.state === 'denied') return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="alert">{t('dashboard.denied')}</AppText><Link href="/account">{t('dashboard.account')}</Link><Link href="/">{t('nav.home')}</Link></View>;
  const localBusiness = currentProfile?.businesses.find(b => b.id === selection.business.id);
  if (active !== selection.business.id || !localBusiness || localBusiness.role !== authorized.businesses.find(b => b.id === selection.business.id)?.role) return <SessionLoading />;
  // Permission/workspace changes unmount all private form drafts and agenda state.
  return <Workspace.Provider value={selection.business}><View key={`${identity}:${version}:${selection.business.id}`} style={{ flex: 1 }}>{children}</View></Workspace.Provider>;
}

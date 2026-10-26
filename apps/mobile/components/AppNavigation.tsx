import { useRef, useState, type ComponentRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';
import { apiRequest } from '@/src/lib/api';
import type { AuthProfile } from '@/src/types/flows';
import { signOut } from '@/src/lib/auth';
import { menuCapabilities, type AccountNavigation } from '@/src/lib/navigation';

export function AppNavigation() {
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
  return <View style={{ direction }} className="border-b border-line bg-surface">
    <View className="mx-auto w-full max-w-3xl flex-row items-center justify-between gap-3 px-5 py-2">
      <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={t('nav.open')} accessibilityState={{ expanded: open }} onPress={() => { setError(''); setOpen(true); void account.refetch(); }} className="min-h-12 min-w-12 items-center justify-center rounded-control border border-line"><AppText style={{ textAlign: 'center' }} className="text-2xl font-semibold text-brand">☰</AppText></Pressable>
      <AppText className="font-semibold tracking-widest text-brand">VISIT</AppText>
      {providerMode ? <AppText className="text-sm text-body">{t('nav.providerMode')}</AppText> : null}
    </View>
    {open ? <Modal transparent visible animationType="none" accessibilityLabel={t('nav.menu')} onRequestClose={close} onDismiss={() => { if (Platform.OS === 'web') trigger.current?.focus(); }}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', direction, alignItems: 'flex-start' }}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={close} style={{ position: 'absolute', inset: 0 }} />
        <SafeAreaView testID="menu-panel" edges={['top', 'bottom']} style={{ width: '88%', maxWidth: 360, flex: 1, backgroundColor: '#fff', direction }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
            <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t('nav.menu')}</AppText>
            <ActionButton secondary label={t('nav.close')} onPress={close} />
            <ActionButton secondary label={t('nav.home')} onPress={() => go('/')} />
            <ActionButton secondary label={t('nav.account')} onPress={() => go('/account')} />
            {account.isFetching && !account.data ? <AppText>{t('account.loading')}</AppText> : null}
            {account.isError ? <><AppText accessibilityRole="alert">{t('account.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void account.refetch()} /></> : <>
              {becomeProvider ? <ActionButton secondary label={t('account.becomeProvider')} onPress={() => go('/register/provider')} /> : null}
              {applicationStatus ? <ActionButton secondary label={t('account.applicationStatus')} onPress={() => go('/register/provider')} /> : null}
              {managed.length ? <ActionButton secondary label={t(providerMode ? 'nav.customerMode' : 'account.switchProvider')} onPress={switchMode} /> : null}
              {choosingBusiness ? <View className="gap-3 rounded-control border border-line p-3"><AppText className="font-semibold">{t('nav.chooseBusiness')}</AppText>{managed.map(m => <ActionButton key={m.business.id} secondary label={m.business.name} disabled={busy} onPress={() => void provider(m.business.id)} />)}</View> : null}
            </>}
            <ActionButton secondary label={t('account.signOut')} busy={busy} onPress={() => void logout()} />
            {error ? <AppText accessibilityRole="alert" className="text-danger">{error}</AppText> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal> : null}
  </View>;
}

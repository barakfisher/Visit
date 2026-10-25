import { AccountMethods } from '@/components/auth/AccountMethods';
import { useState } from 'react';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { LanguageSettings } from '@/components/LanguageSettings';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ActionButton } from '@/components/ActionButton';
import { signOut } from '@/src/lib/auth';
import { apiRequest } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import { SessionLoading } from '@/components/SessionLoading';
import { menuCapabilities } from '@/src/lib/navigation';


export default function AccountScreen() {
  const { t } = useAppLocale();
  const identityId = useSessionStore((state) => state.identityId);
  const bootstrap = useSessionStore(state => state.bootstrapStatus);
  const account = useQuery({ queryKey: ['me', identityId], queryFn: () => apiRequest<{ identity: { platformRole: string }; memberships: { role: string; status: string; business: { id: string; name: string; approvalStatus: string } }[]; providerApplications: { id: string; status: string; business: { name: string } }[] }>('/v1/me'), enabled: Boolean(identityId) });
  const [signingOut, setSigningOut] = useState(false);
  const [methodsBusy, setMethodsBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  async function logout() {
    setSigningOut(true); setSignOutError('');
    try { await signOut(); }
    catch { setSignOutError(t('account.signOutFailed')); }
    finally { setSigningOut(false); }
  }
  const { applicationStatus, becomeProvider } = menuCapabilities(account.data);
  if (!identityId && bootstrap !== 'ready') return <SessionLoading />;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-8 md:px-8">
    <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t('nav.account')}</Text><Text className="leading-6 text-body">{identityId ? t('account.intro') : t('account.guestIntro')}</Text></View>
    <LanguageSettings />
    {identityId ? <AccountMethods onBusyChange={setMethodsBusy} /> : null}
    {identityId ? <ActionButton secondary label={t('account.signOut')} disabled={methodsBusy} busy={signingOut} onPress={() => void logout()} /> : null}
    {signOutError ? <Text accessibilityRole="alert" className="text-danger">{signOutError}</Text> : null}
    {!identityId ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text className="font-semibold text-ink">{t('account.title')}</Text><Text className="leading-6 text-body">{t('account.guestHelp')}</Text><Link href="/auth/login" className="self-start rounded-control bg-brand px-5 py-4 font-semibold text-white">{t('common.signIn')}</Link></View> : account.isLoading ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">{t('account.loading')}</Text></View> : account.isError ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text accessibilityRole="alert" className="text-warning">{t('account.failure')}</Text><Pressable onPress={() => void account.refetch()} className="self-start rounded-control border border-line px-4 py-3"><Text className="font-semibold text-brand">{t('common.retry')}</Text></Pressable></View> : <>
      {applicationStatus || becomeProvider ? <Link href="/register/provider" className="min-h-action rounded-control border border-line px-4 py-4 font-semibold text-brand">{t(applicationStatus ? 'account.applicationStatus' : 'account.becomeProvider')}</Link> : null}
      {account.data?.identity.platformRole === 'ADMIN' ? <Link href="/admin/applications" className="min-h-action rounded-control border border-line px-4 py-4 font-semibold text-brand">{t('review.admin')}</Link> : null}
    </>}
  </ScrollView>;
}

import { AccountMethods } from '@/components/auth/AccountMethods';
import { useState } from 'react';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { LanguageSettings } from '@/components/LanguageSettings';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ActionButton } from '@/components/ActionButton';
import { ContactPhone } from '@/components/ContactPhone.component';
import { SignOutIcon } from '@/components/NavigationIcons.component';
import { tokens } from '@/src/design/tokens';
import { signOut } from '@/src/lib/auth';
import { apiRequest } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import { SessionLoading } from '@/components/SessionLoading';
import { accountBusiness, menuCapabilities } from '@/src/lib/navigation';


export default function AccountScreen() {
  const { t, direction } = useAppLocale();
  const business = accountBusiness('/account', useLocalSearchParams<{ businessId?: string }>().businessId, useSessionStore(state => state.profile?.businesses));
  const identityId = useSessionStore((state) => state.identityId);
  const bootstrap = useSessionStore(state => state.bootstrapStatus);
  const account = useQuery({ queryKey: ['me', identityId], queryFn: () => apiRequest<{ identity: { platformRole: string; contactPhone: string | null }; memberships: { role: string; status: string; business: { id: string; name: string; approvalStatus: string } }[]; providerApplications: { id: string; status: string; business: { name: string } }[] }>('/v1/me'), enabled: Boolean(identityId) });
  const [signingOut, setSigningOut] = useState(false);
  const [methodsBusy, setMethodsBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  async function logout() {
    setSigningOut(true); setSignOutError('');
    try { await signOut(); }
    catch { setSignOutError(t('account.signOutFailed')); }
    finally { setSigningOut(false); }
  }
  const { applicationStatus, becomeProvider, reviewApplications } = menuCapabilities(account.data);
  if (!identityId && bootstrap !== 'ready') return <SessionLoading />;
  return <ScrollView testID="account-screen" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-4 px-5 pb-8 pt-3 md:px-8">
    <LanguageSettings />
    {/* The settings left the footer for this entry, so it shows only when Account was opened from a business. */}
    {business ? <ActionButton secondary label={t('nav.businessSettings')} onPress={() => router.push({ pathname: '/provider/[businessId]', params: { businessId: business } })} /> : null}
    {identityId && account.data ? <ContactPhone saved={account.data.identity.contactPhone} /> : null}
    {identityId ? <AccountMethods onBusyChange={setMethodsBusy} /> : null}
    {!identityId ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text className="font-semibold text-ink">{t('account.title')}</Text><Text className="leading-6 text-body">{t('account.guestHelp')}</Text><Link href="/auth/login" className="self-start rounded-control bg-brand px-5 py-4 font-semibold text-white">{t('common.signIn')}</Link></View> : account.isLoading ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">{t('account.loading')}</Text></View> : account.isError ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text accessibilityRole="alert" className="text-warning">{t('account.failure')}</Text><Pressable onPress={() => void account.refetch()} className="self-start rounded-control border border-line px-4 py-3"><Text className="font-semibold text-brand">{t('common.retry')}</Text></Pressable></View> : <>
      {applicationStatus || becomeProvider ? <Link href="/register/provider" className="min-h-action rounded-control border border-line px-4 py-4 font-semibold text-brand">{t(applicationStatus ? 'account.applicationStatus' : 'account.becomeProvider')}</Link> : null}
    </>}
    {reviewApplications ? <View testID="system-admin" style={{ borderColor: tokens.color.warning }} className="gap-2 rounded-card border-2 p-4">
      <Text accessibilityRole="header" style={{ color: tokens.color.warning }} className="font-bold">{t('account.systemAdmin')}</Text>
      <Text className="text-sm text-body">{t('account.systemAdminNote')}</Text>
      <ActionButton secondary label={t('review.admin')} onPress={() => router.push('/admin/applications')} />
    </View> : null}
    {identityId ? <View className="gap-2 pt-2">
      {signOutError ? <Text accessibilityRole="alert" className="text-danger">{signOutError}</Text> : null}
      <ActionButton testID="sign-out" secondary danger busy={signingOut} disabled={methodsBusy} label={t('account.signOut')} icon={color => <SignOutIcon color={color} pointsRight={direction === 'ltr'} />} onPress={() => void logout()} />
    </View> : null}
  </ScrollView>;
}

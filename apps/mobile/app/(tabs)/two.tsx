import { PILOT_TIMEZONE } from '@visit/contracts';
import { AccountMethods } from '@/components/auth/AccountMethods';
import { useState } from 'react';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { LanguageSettings } from '@/components/LanguageSettings';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ActionButton } from '@/components/ActionButton';
import { signOut } from '@/src/lib/auth';
import { apiRequest } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';

type ApplicationResponse = { id: string; status: string; message: string };

export default function AccountScreen() {
  const { t } = useAppLocale();
  const identityId = useSessionStore((state) => state.identityId);
  const account = useQuery({ queryKey: ['me', identityId], queryFn: () => apiRequest<{ memberships: { role: string; status: string; business: { id: string; name: string; approvalStatus: string } }[]; providerApplications: { id: string; status: string; business: { name: string } }[] }>('/v1/me'), enabled: Boolean(identityId) });
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const timezone = PILOT_TIMEZONE;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [methodsBusy, setMethodsBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  async function logout() {
    setSigningOut(true); setSignOutError('');
    try { await signOut(); }
    catch { setSignOutError(t('account.signOutFailed')); }
    finally { setSigningOut(false); }
  }
  const managed = account.data?.memberships.filter((item) => item.status === 'ACTIVE' && item.business.approvalStatus === 'APPROVED' && ['OWNER', 'MANAGER'].includes(item.role)) ?? [];

  async function submit() {
    setBusy(true); setError('');
    try {
      await apiRequest<ApplicationResponse>('/v1/provider-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessName, slug, timezone }) });
      setMessage(t('account.submitted'));
    } catch { setError(t('account.submitFailed')); }
    finally { setBusy(false); }
  }

  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-8 md:px-8">
    <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t('nav.account')}</Text><Text className="leading-6 text-body">{identityId ? t('account.intro') : t('account.guestIntro')}</Text></View>
    <LanguageSettings />
    {identityId ? <AccountMethods onBusyChange={setMethodsBusy} /> : null}
    {identityId ? <ActionButton secondary label={t('account.signOut')} disabled={methodsBusy} busy={signingOut} onPress={() => void logout()} /> : null}
    {signOutError ? <Text accessibilityRole="alert" className="text-danger">{signOutError}</Text> : null}
    {!identityId ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text className="font-semibold text-ink">{t('account.title')}</Text><Text className="leading-6 text-body">{t('account.guestHelp')}</Text><Link href="/auth/login" className="self-start rounded-control bg-brand px-5 py-4 font-semibold text-white">{t('common.signIn')}</Link></View> : account.isLoading ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">{t('account.loading')}</Text></View> : account.isError ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text accessibilityRole="alert" className="text-warning">{t('account.failure')}</Text><Pressable onPress={() => void account.refetch()} className="self-start rounded-control border border-line px-4 py-3"><Text className="font-semibold text-brand">{t('common.retry')}</Text></Pressable></View> : <>
      {managed.length ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text className="font-semibold text-ink">{t('account.workspace')}</Text><Text className="text-sm leading-5 text-body">{t('account.approved')}</Text>{managed.map((item) => <Link key={item.business.id} href={{ pathname: '/provider/dashboard', params: { businessId: item.business.id } }} className="rounded-control border border-line px-4 py-4"><Text className="font-semibold text-brand">{t('account.switchProvider')} · {item.business.name}</Text><Text className="mt-1 text-sm text-body">{t('account.manage')} · {item.role === 'OWNER' ? t('account.owner') : t('account.manager')}</Text></Link>)}</View> : null}
      {account.data?.providerApplications.length ? <View className="gap-2 rounded-card border border-line bg-surface p-card"><Text className="font-semibold text-ink">{t('account.applicationStatus')}</Text>{account.data.providerApplications.map((item) => <Text key={item.id} className="text-sm leading-5 text-body">{item.business.name} · {item.status === 'PENDING' ? t('account.pending') : item.status === 'APPROVED' ? t('account.applicationApproved') : t('account.rejected')}</Text>)}</View> : null}
      {!managed.length && !account.data?.providerApplications.length ? <View className="gap-4 rounded-card border border-line bg-surface p-card"><View className="gap-1"><Text className="text-xl font-semibold text-ink">{t('account.becomeProvider')}</Text><Text className="text-sm leading-5 text-body">{t('account.applyHelp')}</Text></View>
      <View className="gap-4 rounded-card border border-line bg-surface p-card">
        <TextInput accessibilityLabel={t('account.businessName')} placeholder={t('account.businessName')} value={businessName} onChangeText={setBusinessName} className="rounded-control border border-line px-4 py-4 text-ink" />
        <TextInput accessibilityLabel={t('account.slug')} style={{ writingDirection: 'ltr', textAlign: 'left' }} autoCapitalize="none" placeholder="business-url-name" value={slug} onChangeText={(value) => setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className="rounded-control border border-line px-4 py-4 text-ink" />
        <TextInput accessibilityLabel={t('account.timezone')} style={{ writingDirection: 'ltr', textAlign: 'left' }} autoCapitalize="none" placeholder="Asia/Jerusalem" value={timezone} editable={false} className="rounded-control border border-line px-4 py-4 text-ink" />
        <Text className="text-sm leading-5 text-body">{t('account.timezoneHint')}</Text>
        <Pressable disabled={busy || !businessName || !slug || !timezone} onPress={submit} accessibilityRole="button" className="items-center rounded-control bg-brand px-5 py-4 disabled:opacity-50">{busy ? <ActivityIndicator color="white" /> : <Text className="font-semibold text-white">{t('account.submit')}</Text>}</Pressable>
      </View>
      {message ? <Text accessibilityRole="alert" className="rounded-control bg-brand-soft p-4 leading-6 text-ink">{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" className="text-sm text-warning">{error}</Text> : null}
      </View> : null}
    </>}
  </ScrollView>;
}

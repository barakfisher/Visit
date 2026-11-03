import { ScreenContent } from '@/components/ScreenContent';
import { useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { safeAuthReturnTo } from '@visit/contracts';
import { usePasswordSignIn } from '@/src/lib/PasswordSignIn.hook';
import { usePhoneSignIn } from '@/src/lib/usePhoneSignIn';
import { PhoneSignIn } from '@/components/auth/PhoneSignIn';
import { PasswordSignIn } from '@/components/auth/PasswordSignIn.component';
import { AuthHeader } from '@/components/auth/AuthHeader.component';
import { GoogleSigninButton } from '@/components/auth/GoogleSigninButton';
import { apiRequest } from '@/src/lib/api';
import { PROVIDER_REGISTRATION_PATH, showsProviderEntry } from '@/src/lib/navigation';

// Email + password is the MVP's primary sign-in (decisions.md, 2026-11-01). Phone sign-in appears only
// where SMS is configured; email-link sign-in stays reachable at /auth/email but is not offered here.
export default function LoginScreen() {
  const { t } = useAppLocale();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeAuthReturnTo(params.returnTo);
  const password = usePasswordSignIn('sign-in', returnTo), phone = usePhoneSignIn(returnTo);
  const [googleBusy, setGoogleBusy] = useState(false), [googleError, setGoogleError] = useState('');
  const capabilities = useQuery({ queryKey: ['auth', 'capabilities'], queryFn: () => apiRequest<{ sms: boolean; google: boolean; googleNative: boolean }>('/api/auth/capabilities') });
  const sms = capabilities.data?.sms ?? false, blocked = password.busy || phone.busy || phone.issued || googleBusy;
  return <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center px-5 py-10"><ScreenContent form className="gap-6 rounded-card border border-line bg-surface">
    <AuthHeader title={t('auth.welcome')} intro={t('auth.intro')} />
    <PasswordSignIn {...password} blocked={phone.busy || phone.issued || googleBusy} />
    <Link href={{ pathname: '/auth/sign-up', params: returnTo ? { returnTo } : {} }} onPress={event => { if (blocked) event.preventDefault(); }} className="min-h-touch py-3 text-center font-semibold text-brand">{t('password.toSignUp')}</Link>
    <View className="flex-row items-center gap-4"><View className="h-px flex-1 bg-line"/><Text className="text-xs uppercase tracking-wider text-muted">{t('auth.otherMethods')}</Text><View className="h-px flex-1 bg-line"/></View>
    <GoogleSigninButton enabled={Platform.OS === 'web' ? capabilities.data?.google : capabilities.data?.googleNative} returnTo={returnTo} disabled={password.busy || phone.busy || phone.issued} onBusyChange={setGoogleBusy} onError={setGoogleError} />
    {googleError ? <Text accessibilityRole="alert" className="text-sm text-danger">{googleError}</Text> : null}
    {sms ? <><View className="flex-row items-center gap-4"><View className="h-px flex-1 bg-line"/><Text className="text-xs uppercase tracking-wider text-muted">{t('auth.phoneAlternative')}</Text><View className="h-px flex-1 bg-line"/></View>
      <PhoneSignIn {...phone} enabled blocked={password.busy || googleBusy} send={() => void phone.send()} verify={() => void phone.verify()} /></> : null}
    {/* Someone already on the provider path does not need the link back to where they came from. */}
    {showsProviderEntry(returnTo) ? <Link href={PROVIDER_REGISTRATION_PATH} onPress={event => { if (blocked) event.preventDefault(); }} className="min-h-touch py-3 text-center text-sm font-semibold text-brand">{t('auth.providerEntry')}</Link> : null}
  </ScreenContent></ScrollView></KeyboardAvoidingView>;
}

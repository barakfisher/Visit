import { ScreenContent } from '@/components/ScreenContent';
import { useState } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Link, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { safeAuthReturnTo } from '@visit/contracts';
import { usePhoneSignIn } from '@/src/lib/usePhoneSignIn';
import { PhoneSignIn } from '@/components/auth/PhoneSignIn';
import { ActionButton } from '@/components/ActionButton';
import { GoogleSigninButton } from '@/components/auth/GoogleSigninButton';
import { apiRequest } from '@/src/lib/api';

export default function LoginScreen() {
  const { t } = useAppLocale();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeAuthReturnTo(params.returnTo);
  const phone = usePhoneSignIn(returnTo);
  const [googleBusy, setGoogleBusy] = useState(false), [googleError, setGoogleError] = useState('');
  const capabilities = useQuery({ queryKey: ['auth', 'capabilities'], queryFn: () => apiRequest<{ sms: boolean; google: boolean; googleNative: boolean }>('/api/auth/capabilities') });
  const sms = capabilities.data?.sms ?? false;
  const emailBuildRequired = Platform.OS !== 'web' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center px-5 py-10"><ScreenContent form className="gap-6 rounded-card border border-line bg-surface">
    <View className="gap-3"><View className="h-12 w-12 items-center justify-center rounded-control bg-brand"><Text className="text-2xl font-bold text-white">V</Text></View><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t('auth.welcome')}</Text><Text className="leading-6 text-body">{t('auth.intro')}</Text></View>
    <GoogleSigninButton enabled={Platform.OS === 'web' ? capabilities.data?.google : capabilities.data?.googleNative} returnTo={returnTo} disabled={phone.busy || phone.issued} onBusyChange={setGoogleBusy} onError={setGoogleError} />
    <View className="flex-row items-center gap-4"><View className="h-px flex-1 bg-line"/><Text className="text-xs uppercase tracking-wider text-muted">{t('auth.phoneAlternative')}</Text><View className="h-px flex-1 bg-line"/></View>
    <PhoneSignIn {...phone} enabled={sms} blocked={googleBusy} send={() => void phone.send()} verify={() => void phone.verify()} />
    {googleError ? <Text accessibilityRole="alert" className="text-sm text-danger">{googleError}</Text> : null}
    {phone.busy || phone.issued || googleBusy ? <ActionButton secondary disabled label={t('auth.email')} /> : emailBuildRequired ? <ActionButton secondary disabled label={t('email.nativeBuild')} /> : <Link href={{ pathname: '/auth/email', params: returnTo ? { returnTo } : {} }} className="min-h-touch py-3 text-center font-semibold text-brand">{t('auth.email')}</Link>}
    <Link href="/register/provider" onPress={event => { if (phone.busy || googleBusy) event.preventDefault(); }} className="min-h-touch py-3 text-center text-sm font-semibold text-brand">{t('auth.providerEntry')}</Link>
  </ScreenContent></ScrollView></KeyboardAvoidingView>;
}

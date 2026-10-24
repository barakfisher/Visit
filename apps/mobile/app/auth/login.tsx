import { useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { isolateLtr } from '@/src/i18n/messages';
import { ActionButton } from '@/components/ActionButton';
import { PhoneInput } from '@/components/auth/PhoneInput';
import { OTPInput } from '@/components/auth/OTPInput';
import { GoogleSigninButton } from '@/components/auth/GoogleSigninButton';
import { apiRequest } from '@/src/lib/api';
import { completeSignIn } from '@/src/lib/auth';

export default function LoginScreen() {
  const { t } = useAppLocale();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const capabilities = useQuery({ queryKey: ['auth', 'capabilities'], queryFn: () => apiRequest<{ sms: boolean; google: boolean }>('/api/auth/capabilities') });
  const sms = capabilities.data?.sms ?? false;
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!sent) { await apiRequest('/api/auth/otp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }); setSent(true); }
      else { const result = await apiRequest<{ sessionToken?: string }>('/api/auth/otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) }); await completeSignIn(result.sessionToken, returnTo); }
    } catch { setError(t('auth.failure')); }
    finally { setBusy(false); }
  }
  async function google(idToken: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await apiRequest<{ sessionToken?: string }>('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }); await completeSignIn(result.sessionToken, returnTo); }
    catch { setError(t('auth.failure')); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center px-5 py-10"><View className="mx-auto w-full max-w-lg gap-6 rounded-card border border-line bg-surface p-6 md:p-8">
    <View className="gap-3"><View className="h-12 w-12 items-center justify-center rounded-control bg-brand"><Text className="text-2xl font-bold text-white">V</Text></View><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t('auth.welcome')}</Text><Text className="leading-6 text-body">{t('auth.intro')}</Text></View>
    <GoogleSigninButton enabled={capabilities.data?.google} onCredential={(idToken) => void google(idToken)} onError={setError} />
    <View className="flex-row items-center gap-4"><View className="h-px flex-1 bg-line"/><Text className="text-xs uppercase tracking-wider text-muted">{t('auth.phoneAlternative')}</Text><View className="h-px flex-1 bg-line"/></View>
    {sent ? <><Text className="text-body">{t('auth.codeSent', { phone: isolateLtr(phone) })}</Text><OTPInput value={code} onChange={setCode}/><ActionButton label={t('auth.verify')} onPress={() => void submit()} busy={busy} disabled={code.length !== 6}/><ActionButton secondary label={t('auth.changePhone')} onPress={() => { setSent(false); setCode(''); setError(''); }}/></> : <><PhoneInput value={phone} onChange={setPhone} disabled={!sms}/><ActionButton label={sms ? t('auth.sendCode') : t('auth.smsUnavailable')} onPress={() => void submit()} disabled={!sms || !/^\+[1-9]\d{7,14}$/.test(phone)} busy={busy}/></>}
    {error ? <Text accessibilityRole="alert" className="text-sm leading-5 text-danger">{error}</Text> : null}
    <Link href={{ pathname: '/auth/email', params: returnTo ? { returnTo } : {} }} className="text-center font-semibold text-brand">{t('auth.email')}</Link>
  </View></ScrollView></KeyboardAvoidingView>;
}

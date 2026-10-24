import { useEffect, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { AppText as Text } from '@/components/AppText';
import { completeSignIn } from '@/src/lib/auth';
import { apiRequest, ApiError } from '@/src/lib/api';
import { useEmailLink } from '@/src/lib/useEmailLink';
import { useAppLocale } from '@/src/i18n/LocaleContext';

type ChallengeResult = { accepted: boolean; resendAfterSeconds: number };
type LoginResult = { sessionToken?: string };
export default function AuthScreen() {
  const { t } = useAppLocale();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const received = useEmailLink();
  const [email, setEmail] = useState(''), [localToken, setLocalToken] = useState('');
  const [sent, setSent] = useState(false), [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<LoginResult | null>(null);
  const [error, setError] = useState(''), [cooldown, setCooldown] = useState(0);
  const token = received.token || localToken;
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const failure = (reason: unknown) => reason instanceof ApiError && reason.status === 429 ? t('email.rateLimited') : t('email.failure');
  async function requestLink() {
    setBusy(true); setError('');
    try {
      const result = await apiRequest<ChallengeResult>('/v1/auth/email-challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, target: Platform.OS === 'web' ? 'web' : 'native' }) });
      setSent(true); setCooldown(result.resendAfterSeconds);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError('');
    try {
      let session = issued;
      if (!session) {
        session = await apiRequest<LoginResult>('/v1/auth/email-challenges/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        setIssued(session); received.clear(); setLocalToken('');
      }
      await completeSignIn(session.sessionToken, returnTo);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  async function loadLocalLink() {
    setBusy(true); setError('');
    try { const result = await apiRequest<{ token: string }>(`/__dev/mailbox?email=${encodeURIComponent(email)}`); setLocalToken(result.token); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  function recover() { setIssued(null); received.clear(); setLocalToken(''); setSent(false); setError(''); }
  return <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-canvas" contentContainerClassName="px-5 py-8">
    <View className="mx-auto w-full max-w-lg gap-5 rounded-card border border-line bg-surface p-card">
      <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t('email.title')}</Text><Text className="leading-6 text-body">{t('email.intro')}</Text></View>
      {token || issued ? <>
        <Text className="leading-6 text-body">{t('email.confirmHelp')}</Text>
        <ActionButton label={t('email.verify')} busy={busy} onPress={() => void verify()} />
        <ActionButton secondary label={t('email.recover')} disabled={busy} onPress={recover} />
      </> : <>
        <TextInput autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" accessibilityLabel={t('email.address')} placeholder="you@example.com" value={email} onChangeText={setEmail} style={{ writingDirection: 'ltr', textAlign: 'left' }} className="rounded-control border border-line px-4 py-4 text-ink" />
        {sent ? <Text accessibilityRole="status" className="leading-6 text-body">{t('email.sent')}</Text> : null}
        <ActionButton label={cooldown ? t('email.resendIn', { seconds: cooldown }) : sent ? t('email.resend') : t('email.send')} busy={busy} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || cooldown > 0} onPress={() => void requestLink()} />
        {__DEV__ && sent ? <ActionButton secondary label={t('email.localLink')} busy={busy} onPress={() => void loadLocalLink()} /> : null}
      </>}
      {error ? <Text accessibilityRole="alert" className="text-sm text-danger">{error}</Text> : null}
      <Link href="/auth/login" className="text-center text-sm font-semibold text-brand">{t('email.back')}</Link>
    </View>
  </ScrollView>;
}

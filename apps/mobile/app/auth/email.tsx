import { useEffect, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { completeSignIn } from '@/src/lib/auth';
import { apiRequest, ApiError } from '@/src/lib/api';
import { saveSessionToken } from '@/src/lib/sessionToken';
import { useSessionStore } from '@/src/state/session';

type ChallengeResult = { accepted: boolean; message: string };
type LoginResult = { sessionToken?: string; identity: { id: string; email: string | null } };

export default function AuthScreen() {
  const params = useLocalSearchParams<{ token?: string; returnTo?: string }>();
  const linkToken = typeof params.token === 'string' ? params.token : '';
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const setIdentity = useSessionStore((state) => state.setIdentity);

  async function requestLink() {
    setBusy(true); setError('');
    try {
      const result = await apiRequest<ChallengeResult>('/v1/auth/email-challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      setNotice(result.message); setStep('verify');
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Could not request a sign-in link.'); }
    finally { setBusy(false); }
  }

  async function verify(value = token) {
    setBusy(true); setError('');
    try {
      const result = await apiRequest<LoginResult>('/v1/auth/email-challenges/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: value }) });
      if (result.sessionToken) await saveSessionToken(result.sessionToken);
      setIdentity(result.identity.id); setNotice('Signed in. Your account is ready.');
      await completeSignIn(result.sessionToken, params.returnTo);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'That sign-in link could not be verified.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!linkToken) return;
    // A one-time link is an external navigation event, so consume it on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verify(linkToken);
    // Verify a one-time URL token once when the screen receives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkToken]);

  async function loadLocalLink() {
    setBusy(true); setError('');
    try {
      const result = await apiRequest<{ token: string }>(`/__dev/mailbox?email=${encodeURIComponent(email)}`);
      setToken(result.token); setNotice('Local development sign-in link loaded.');
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'No local sign-in link was found.'); }
    finally { setBusy(false); }
  }

  return <View className="flex-1 bg-canvas px-5 py-8">
    <View className="mx-auto w-full max-w-lg gap-5 rounded-card border border-line bg-surface p-card">
      <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit account</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">Sign in with email</Text><Text className="leading-6 text-body">We’ll email you a one-time link. No password to remember.</Text></View>
      {step === 'email' ? <>
        <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" accessibilityLabel="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} onChange={(event) => setEmail(event.nativeEvent.text)} className="rounded-control border border-line px-4 py-4 text-ink" />
        <Pressable disabled={busy || !email} onPress={requestLink} accessibilityRole="button" className="items-center rounded-control bg-brand px-5 py-4 disabled:opacity-50">{busy ? <ActivityIndicator color="white" /> : <Text className="font-semibold text-white">Email me a sign-in link</Text>}</Pressable>
      </> : <>
        <Text className="text-sm leading-5 text-body">{notice}</Text>
        <TextInput autoCapitalize="none" accessibilityLabel="One-time sign-in link token" placeholder="Paste the sign-in token" value={linkToken || token} editable={!linkToken} onChangeText={setToken} className="rounded-control border border-line px-4 py-4 text-ink" />
        <Pressable disabled={busy || !(linkToken || token)} onPress={() => void verify(linkToken || token)} accessibilityRole="button" className="items-center rounded-control bg-brand px-5 py-4 disabled:opacity-50">{busy ? <ActivityIndicator color="white" /> : <Text className="font-semibold text-white">Verify sign-in</Text>}</Pressable>
        {__DEV__ ? <Pressable onPress={loadLocalLink} accessibilityRole="button" className="items-center rounded-control border border-line px-5 py-4"><Text className="font-semibold text-ink">Load local development link</Text></Pressable> : null}
      </>}
      {error ? <Text accessibilityRole="alert" className="text-sm text-warning">{error}</Text> : null}
      {notice && step === 'email' ? <Text className="text-sm text-body">{notice}</Text> : null}
      <Link href="/" className="text-center text-sm font-semibold text-brand">Back to Visit</Link>
    </View>
  </View>;
}

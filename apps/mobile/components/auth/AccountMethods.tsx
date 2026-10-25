import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { ActionButton } from '../ActionButton';
import { AppText as Text } from '../AppText';
import { OTPInput } from './OTPInput';
import { GoogleSigninButton } from './GoogleSigninButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest, ApiError } from '@/src/lib/api';
import { refreshAccountAfterChange } from '@/src/lib/auth';
import { useSessionStore } from '@/src/state/session';

type Method = { id: string; method: 'email' | 'phone' | 'google'; label: string | null; verified: boolean; canRemove: boolean };
type Notification = { channel: 'email' | 'phone'; status: 'QUEUED' | 'SENDING' | 'ACCEPTED' | 'FAILED' | 'BLOCKED'; provider: string | null };
type Methods = { identityId: string; methods: Method[]; events: { id: string; action: 'LINKED' | 'REPLACED' | 'REMOVED'; method: Method['method']; createdAt: string; notifications: Notification[] }[]; capabilities: { email: boolean; phone: boolean }; reauthRequired: boolean };
type Issued = { identity: { id: string }; sessionToken?: string };
export function AccountMethods({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { t, locale } = useAppLocale();
  const identityId = useSessionStore(state => state.identityId);
  const methods = useQuery({ queryKey: ['account-methods', identityId], queryFn: async () => { const result = await apiRequest<Methods>('/api/account/sign-in-methods'); if (result.identityId !== identityId) throw new ApiError('The signed-in account changed.', 'SESSION_CHANGED', 409); return result; }, enabled: Boolean(identityId), refetchInterval: 30000 });
  const capabilities = useQuery({ queryKey: ['auth', 'capabilities'], queryFn: () => apiRequest<{ google: boolean; googleNative: boolean }>('/api/auth/capabilities') });
  const [channel, setChannel] = useState<'email' | 'phone'>('email'), [destination, setDestination] = useState('');
  const [challenge, setChallenge] = useState(''), [code, setCode] = useState(''), [cooldown, setCooldown] = useState(0);
  const [removing, setRemoving] = useState<Method | null>(null), [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(false);
  const reauth = methods.data?.reauthRequired ?? true;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  function failure(reason: unknown) {
    if (reason instanceof ApiError) {
      if (reason.code === 'REAUTH_REQUIRED' || reason.status === 401) { void methods.refetch(); return t('methods.reauth'); }
      if (reason.code === 'METHOD_UNAVAILABLE') return t('methods.conflict');
      if (reason.code === 'LAST_LOGIN_METHOD') return t('methods.last');
      if (reason.status === 429) return t('email.rateLimited');
    }
    return t('methods.failure');
  }
  function resetDraft() { setChallenge(''); setCode(''); setRemoving(null); setError(''); }
  async function start() {
    setBusy(true); setError(''); setSuccess(false);
    try {
      const result = await apiRequest<{ challenge: string; resendAfterSeconds: number }>('/api/account/contact-challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, destination, consent: true }) });
      setChallenge(result.challenge); setCode(''); setCooldown(result.resendAfterSeconds);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  async function finish(remove?: Method) {
    setBusy(true); setError(''); setSuccess(false);
    try {
      let result = issued;
      if (!result) {
        result = await apiRequest<Issued>(remove ? '/api/account/sign-in-methods/remove' : '/api/account/contact-challenges/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(remove ? { method: remove.method, ...(remove.method === 'google' ? { id: remove.id } : {}), consent: true } : { challenge, code, consent: true }) });
        setIssued(result); setChallenge(''); setCode(''); // Preserve replacement across profile failure; never replay the proof.
      }
      await refreshAccountAfterChange(result);
      setIssued(null); setRemoving(null); setDestination(''); setSuccess(true);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  async function loadLocalCode() {
    setBusy(true); setError('');
    try { const result = await apiRequest<{ code: string }>('/__dev/account/contact-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge }) }); setCode(result.code); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  const available = methods.data?.capabilities[channel] ?? false;
  const valid = channel === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination.trim()) : /^\+[1-9]\d{7,14}$/.test(destination.trim().replace(/[\s()-]/g, ''));
  return <View className="gap-4 rounded-card border border-line bg-surface p-card">
    <Text accessibilityRole="header" className="text-xl font-bold text-ink">{t('methods.title')}</Text>
    <Text className="text-sm leading-5 text-body">{t('methods.intro')}</Text>
    {methods.isLoading ? <Text accessibilityRole="status">{t('common.loading')}</Text> : methods.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void methods.refetch()} /> : <>
      {reauth ? <View className="gap-2"><Text className="text-warning">{t('methods.reauth')}</Text><Link href="/auth/login" className="font-semibold text-brand">{t('methods.signInAgain')}</Link></View> : null}
      {methods.data?.methods.map(method => <View key={method.id} className="gap-2 rounded-control border border-line p-4">
        <Text className="font-semibold text-ink">{t(`methods.${method.method}`)} · {t(method.verified ? 'methods.verified' : 'methods.unverified')}</Text>
        {method.label ? <Text style={{ writingDirection: 'ltr', textAlign: 'left' }} className="text-body">{method.label}</Text> : null}
        <ActionButton secondary disabled={reauth || busy || Boolean(issued) || !method.canRemove} label={t(method.canRemove ? 'methods.remove' : 'methods.last')} onPress={() => { setRemoving(method); setError(''); }} />
      </View>)}
      {issued ? <ActionButton label={t('methods.resume')} busy={busy} onPress={() => void finish()} /> : removing ? <View className="gap-3 rounded-control border border-line p-4"><Text className="text-body">{t('methods.removeHelp')}</Text><ActionButton label={t('methods.confirmRemove')} busy={busy} onPress={() => void finish(removing)} /><ActionButton secondary label={t('catalog.cancel')} disabled={busy} onPress={() => setRemoving(null)} /></View> : <>
        <Text className="font-semibold text-ink">{t('methods.change')}</Text>
        <View accessibilityLabel={t('methods.choose')} className="flex-row gap-3">{(['email', 'phone'] as const).map(value => <Pressable key={value} accessibilityRole="button" aria-pressed={channel === value} accessibilityState={{ disabled: busy }} disabled={busy} className={`min-h-12 flex-1 justify-center rounded-control border p-3 ${channel === value ? 'border-brand bg-brand-soft' : 'border-line'}`} onPress={() => { setChannel(value); setDestination(''); resetDraft(); }}><Text className="font-semibold text-brand">{t(`methods.${value}`)}</Text></Pressable>)}</View>
        {challenge ? <>
          <Text className="text-body">{t('methods.codeSent')}</Text><Text style={{ writingDirection: 'ltr', textAlign: 'left' }} className="font-semibold text-ink">{destination}</Text><OTPInput value={code} onChange={setCode} />
          <ActionButton label={t('methods.verify')} busy={busy} disabled={reauth || code.length !== 6} onPress={() => void finish()} />
          {__DEV__ ? <ActionButton secondary label={t('methods.localCode')} busy={busy} onPress={() => void loadLocalCode()} /> : null}
          <ActionButton secondary label={t('methods.restart')} disabled={busy} onPress={resetDraft} />
        </> : <>
          <TextInput value={destination} onChangeText={setDestination} editable={available && !reauth && !busy} accessibilityLabel={t(channel === 'email' ? 'methods.newEmail' : 'methods.newPhone')} autoComplete={channel === 'email' ? 'email' : 'tel'} keyboardType={channel === 'email' ? 'email-address' : 'phone-pad'} autoCapitalize="none" autoCorrect={false} placeholder={channel === 'email' ? 'you@example.com' : '+972501234567'} style={{ writingDirection: 'ltr', textAlign: 'left' }} className="rounded-control border border-line px-4 py-4 text-ink" />
          <ActionButton label={!available ? t('methods.unavailable') : cooldown ? t('methods.resendIn', { seconds: cooldown }) : t('methods.send')} busy={busy} disabled={!available || reauth || !valid || cooldown > 0} onPress={() => void start()} />
        </>}
        <GoogleSigninButton intent="link" disabled={reauth || busy} enabled={Platform.OS === 'web' ? capabilities.data?.google : capabilities.data?.googleNative} onError={setError} />
      </>}
      {success ? <Text accessibilityRole="status" className="text-brand">{t('methods.saved')}</Text> : null}
      {methods.data?.events.length ? <View className="gap-3"><Text className="font-semibold text-ink">{t('methods.history')}</Text>{methods.data.events.map(event => <View key={event.id} className="gap-1 border-t border-line pt-3"><Text className="text-sm text-body">{t(`methods.${event.method}`)} · {t(`methods.${event.action}`)}</Text><Text className="text-xs text-muted">{new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</Text>{event.notifications.map((notification, index) => <Text key={index} className="text-xs text-muted">{t(`methods.${notification.channel}`)} · {t(notification.status === 'ACCEPTED' && notification.provider === 'local-inbox' ? 'methods.localAlert' : `methods.${notification.status}`)}</Text>)}</View>)}</View> : null}
    </>}
    {error ? <Text accessibilityRole="alert" className="text-danger">{error}</Text> : null}
    <Text className="text-sm leading-5 text-body">{t('methods.recoveryHelp')}</Text><ActionButton secondary disabled label={t('methods.recovery')} />
  </View>;
}

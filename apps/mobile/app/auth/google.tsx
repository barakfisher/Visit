import { useEffect, useState } from 'react';
import { Link, router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { AppText as Text } from '@/components/AppText';
import { apiRequest, ApiError } from '@/src/lib/api';
import { completeSignIn, refreshAccountAfterChange } from '@/src/lib/auth';
import { useGoogleReceipt } from '@/src/lib/googleFlow';
import { useAppLocale } from '@/src/i18n/LocaleContext';

type Preview = { email: string; intent: 'login' | 'link' };
type Result = { identity: { id: string }; sessionToken?: string; linked?: boolean };
export default function GoogleCallbackScreen() {
  const { t } = useAppLocale();
  const { receipt, clear } = useGoogleReceipt();
  const [preview, setPreview] = useState<Preview | null>(null), [issued, setIssued] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [returnTo, setReturnTo] = useState<string | undefined>();
  const failure = (reason: unknown) => reason instanceof ApiError && reason.code === 'LINK_REQUIRED' ? t('google.linkRequired') : reason instanceof ApiError && reason.code === 'REAUTH_REQUIRED' ? t('google.reauth') : t('google.failure');
  useEffect(() => {
    if (!receipt || !('grant' in receipt)) return;
    let active = true;
    // Preview checks ownership without consuming the proof or creating a Visit session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiRequest<Preview>('/api/auth/google/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant: receipt.grant, ...(receipt.verifier ? { verifier: receipt.verifier } : {}) }) })
      .then(value => { if (active) { setPreview(value); setError(''); setReturnTo(receipt.returnTo); } })
      .catch(() => { if (active) setError(t('google.failure')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [receipt, attempt, t]);
  async function confirm() {
    if (busy || (!issued && (!receipt || !('grant' in receipt) || !preview))) return;
    setBusy(true); setError('');
    try {
      let result = issued;
      if (!result && receipt && 'grant' in receipt) {
        result = await apiRequest<Result>('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant: receipt.grant, ...(receipt.verifier ? { verifier: receipt.verifier } : {}), ...(preview?.intent === 'link' ? { consent: true } : {}) }) });
        setIssued(result); clear(); // A profile outage must not replay the consumed Google proof.
      }
      if (!result) return;
      if (result.linked) {
        await refreshAccountAfterChange(result);
        router.replace('/(tabs)/two');
      } else await completeSignIn(result.sessionToken, returnTo, result.identity.id);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  const status = receipt && 'status' in receipt ? receipt.status : undefined;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-10"><View className="mx-auto w-full max-w-lg gap-5 rounded-card border border-line bg-surface p-card">
    <Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text>
    <Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t('google.title')}</Text>
    {preview || issued ? <>
      {preview ? <><Text className="text-body">{t(preview.intent === 'link' ? 'google.linkHelp' : 'google.confirmHelp')}</Text><Text style={{ writingDirection: 'ltr' }} className="font-semibold text-ink">{preview.email}</Text></> : null}
      <ActionButton label={issued ? t('google.resume') : preview?.intent === 'link' ? t('google.link') : t('google.confirm')} busy={busy} onPress={() => void confirm()} />
    </> : loading || !receipt ? <Text accessibilityRole="status" className="text-body">{t('common.loading')}</Text> : <>
      <Text className="text-body">{t(status === 'cancelled' ? 'google.cancelled' : 'google.failure')}</Text>
      {!status ? <ActionButton secondary label={t('common.retry')} onPress={() => setAttempt(value => value + 1)} /> : null}
    </>}
    {error ? <Text accessibilityRole="alert" className="text-danger">{error}</Text> : null}
    <Link href="/auth/login" onPress={clear} className="text-center font-semibold text-brand">{t('email.back')}</Link>
  </View></ScrollView>;
}

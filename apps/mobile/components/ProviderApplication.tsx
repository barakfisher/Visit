import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { TextField } from './TextField';
import { apiRequest } from '@/src/lib/api';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useAuthStore } from '@/src/state/auth';
import type { MessageKey } from '@/src/i18n/messages';
type Application = { id: string; status: string; reviewReason: string | null; reviewedAt: string | null; business: { name: string }; notification: { status: string; provider: string | null } | null };
const notificationKeys: Record<string, MessageKey> = { QUEUED: 'review.QUEUED', BLOCKED: 'review.BLOCKED', IN_APP: 'review.IN_APP', LOCAL: 'review.LOCAL', ACCEPTED: 'review.ACCEPTED', FAILED: 'review.FAILED', SENDING: 'review.SENDING' };
export function ProviderApplication() {
  const { t, locale } = useAppLocale();
  const identity = useAuthStore(s => s.identityId);
  const applications = useQuery({ queryKey: ['provider-applications', identity], queryFn: () => apiRequest<{ applications: Application[] }>('/v1/provider-applications'), enabled: !!identity, refetchInterval: 15000 });
  const [name, setName] = useState(''), [slug, setSlug] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = useRef(false);
  async function submit() {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await apiRequest('/v1/provider-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessName: name, slug, message, timezone: PILOT_TIMEZONE }) }); setName(''); setSlug(''); setMessage(''); await applications.refetch(); }
    catch { setError(t('review.failure')); } finally { running.current = false; setBusy(false); }
  }
  return <View className="gap-4 rounded-card border border-line bg-surface p-card">
    <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('review.title')}</AppText>
    <AppText className="text-body">{t('review.note')}</AppText>
    {applications.isLoading ? <AppText>{t('common.loading')}</AppText> : applications.isError ? <AppText accessibilityRole="alert">{t('review.failure')}</AppText> : <>
      {applications.data?.applications.map(app => <View key={app.id} className="gap-2 rounded-control border border-line p-4"><AppText className="font-semibold text-ink">{app.business.name}</AppText><AppText>{t(app.status === 'PENDING' ? 'review.pending' : app.status === 'APPROVED' ? 'review.approved' : 'review.rejected')}</AppText>{app.reviewReason ? <AppText>{t('review.reason')}: {app.reviewReason}</AppText> : null}{app.reviewedAt ? <AppText>{new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeZone: PILOT_TIMEZONE }).format(new Date(app.reviewedAt))}</AppText> : null}{app.notification ? <AppText>{t(notificationKeys[app.notification.status] ?? 'review.IN_APP')}</AppText> : null}</View>)}
      {!applications.data?.applications.some(app => app.status !== 'REJECTED') ? <View className="gap-4">
        <TextField label={t('account.businessName')} value={name} onChangeText={setName} editable={!busy} maxLength={120} />
        <TextField label={t('account.slug')} identifier autoCapitalize="none" value={slug} onChangeText={setSlug} editable={!busy} maxLength={80} />
        <TextField label={t('review.message')} value={message} onChangeText={setMessage} editable={!busy} multiline maxLength={1000} />
        <AppText>{t('account.timezoneHint')}</AppText>
        <ActionButton label={t('account.submit')} busy={busy} disabled={name.trim().length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)} onPress={() => void submit()} />
      </View> : null}
    </>}
    {error ? <AppText accessibilityRole="alert" className="text-danger">{error}</AppText> : null}
    <ActionButton secondary label={t('review.refresh')} disabled={busy || applications.isFetching} onPress={() => void applications.refetch()} />
  </View>;
}

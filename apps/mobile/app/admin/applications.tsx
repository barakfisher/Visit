import { useRef, useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { TextField } from '@/components/TextField';
import { ScreenContent } from '@/components/ScreenContent';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest, ApiError } from '@/src/lib/api';
type Item = { id: string; kind: string; message: string | null; identity: { id: string; email: string | null; phone: string | null }; business: { name: string; slug: string; timezone: string } };
export default function AdminApplications() {
  const { t } = useAppLocale();
  const queue = useQuery({ queryKey: ['admin', 'provider-applications'], queryFn: () => apiRequest<{ applications: Item[] }>('/v1/admin/provider-applications'), retry: false });
  const [reason, setReason] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const running = useRef(false);
  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (running.current) return;
    running.current = true; setBusy(true); setFeedback('');
    try { await apiRequest(`/v1/admin/provider-applications/${encodeURIComponent(id)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, reason: reason[id] }) }); setFeedback(t('review.decided')); setReason(current => { const next = { ...current }; delete next[id]; return next; }); await queue.refetch(); }
    catch { setFeedback(t('review.failure')); await queue.refetch(); } finally { running.current = false; setBusy(false); }
  }
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-8"><ScreenContent className="gap-5">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{t('review.admin')}</AppText>
    {queue.isLoading ? <AppText>{t('common.loading')}</AppText> : queue.isError ? <AppText accessibilityRole="alert">{t(queue.error instanceof ApiError && [401, 403].includes(queue.error.status) ? 'review.denied' : 'review.failure')}</AppText> : !queue.data?.applications.length ? <AppText>{t('review.empty')}</AppText> : queue.data.applications.map(item => <View key={item.id} className="gap-4 rounded-card border border-line bg-surface p-card">
      <AppText className="text-xl font-semibold text-ink">{item.business.name}</AppText><AppText>{item.business.slug} · {item.business.timezone}</AppText><AppText>{item.identity.email ?? item.identity.phone ?? item.identity.id}</AppText>{item.message ? <AppText>{item.message}</AppText> : null}
      {item.kind !== 'NEW_BUSINESS' ? <AppText>{t('review.legacy')}</AppText> : null}
      <TextField label={t('review.reason')} hint={t('review.reasonHint')} value={reason[item.id] ?? ''} onChangeText={value => setReason(current => ({ ...current, [item.id]: value }))} editable={!busy} multiline maxLength={1000} />
      <ActionButton label={t('review.approve')} disabled={busy || item.kind !== 'NEW_BUSINESS' || (reason[item.id]?.trim().length ?? 0) < 5} onPress={() => void decide(item.id, 'APPROVED')} />
      <ActionButton secondary label={t('review.reject')} disabled={busy || item.kind !== 'NEW_BUSINESS' || (reason[item.id]?.trim().length ?? 0) < 5} onPress={() => void decide(item.id, 'REJECTED')} />
    </View>)}
    {feedback ? <AppText accessibilityRole="alert">{feedback}</AppText> : null}
    <ActionButton secondary label={t('review.refresh')} disabled={busy} onPress={() => void queue.refetch()} />
    <Link href="/account" className="min-h-touch py-3 font-semibold text-brand">{t('nav.account')}</Link>
  </ScreenContent></ScrollView>;
}

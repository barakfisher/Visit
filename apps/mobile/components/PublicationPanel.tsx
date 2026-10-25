import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import type { MessageKey } from '@/src/i18n/messages';
const blockerKeys: Record<string, MessageKey> = { ADMIN_APPROVAL_REQUIRED: 'publish.approval', ISRAEL_TIME_REVIEW_REQUIRED: 'publish.timezone', COMPLETE_BUSINESS_PROFILE: 'publish.profile', ACTIVE_SERVICE_REQUIRED: 'publish.services', EXPLICIT_POLICY_REQUIRED: 'publish.policy', WORKING_HOURS_REQUIRED: 'publish.hours', ASSIGNED_ACTIVE_STAFF_REQUIRED: 'publish.staff', SERVICE_AND_BUFFERS_MUST_FIT_HOURS: 'publish.hours' };
export function PublicationPanel({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const client = useQueryClient(), running = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const base = `/v1/provider/businesses/${encodeURIComponent(businessId)}/publication`;
  const query = useQuery({ queryKey: ['provider', businessId, 'publication'], queryFn: () => apiRequest<{ ready: boolean; publishedAt: string | null; blockers: Record<string, string> }>(base), refetchInterval: 10000 });
  async function change(published: boolean) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await apiRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) }); await client.invalidateQueries({ predicate: q => ['provider', 'availability', 'public', 'my-providers'].includes(String(q.queryKey[0])) }); }
    catch { setError(t('publish.failure')); await query.refetch(); } finally { running.current = false; setBusy(false); }
  }
  return <View className="gap-3 rounded-card border border-line bg-surface p-card">
    <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('publish.title')}</AppText>
    <AppText className="font-semibold text-brand">{query.data ? t(query.data.publishedAt ? 'publish.live' : 'publish.draft') : t(query.isError ? 'publish.failure' : 'common.loading')}</AppText>
    <AppText className="text-sm text-body">{t('publish.note')}</AppText>
    {query.data ? [...new Set(Object.values(query.data.blockers))].map(code => <AppText key={code} className="text-body">{t(blockerKeys[code] ?? 'publish.failure')}</AppText>) : null}
    {query.isError || error ? <AppText accessibilityRole="alert" className="text-danger">{error || t('publish.failure')}</AppText> : null}
    {query.data?.publishedAt ? <ActionButton secondary label={t('publish.stop')} busy={busy} onPress={() => void change(false)} /> : <ActionButton label={t('publish.action')} disabled={!query.data?.ready || query.isFetching} busy={busy} onPress={() => void change(true)} />}
    <ActionButton secondary label={t('publish.refresh')} disabled={busy || query.isFetching} onPress={() => void query.refetch()} />
  </View>;
}

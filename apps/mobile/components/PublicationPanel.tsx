import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import { blockerMessages } from '@/src/lib/BusinessReadiness';
import { useBusinessReadiness } from '@/src/lib/BusinessReadiness.hook';
export function PublicationPanel({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const client = useQueryClient(), running = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const query = useBusinessReadiness(businessId);
  async function change(published: boolean) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await apiRequest(`/v1/provider/businesses/${encodeURIComponent(businessId)}/publication`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) }); await client.invalidateQueries({ predicate: q => ['provider', 'availability', 'public', 'my-providers'].includes(String(q.queryKey[0])) }); }
    catch { setError(t('publish.failure')); await query.refetch(); } finally { running.current = false; setBusy(false); }
  }
  const data = query.data;
  return <View className="gap-3 rounded-card border border-line bg-surface p-card">
    <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('publish.title')}</AppText>
    <AppText className="font-semibold text-brand">{data ? t(data.publishedAt ? 'publish.live' : 'publish.draft') : t(query.isError ? 'publish.failure' : 'common.loading')}</AppText>
    {data && !data.ready ? [...new Set(Object.values(data.blockers))].map(code => <AppText key={code} className="text-body">{t(blockerMessages[code] ?? 'publish.failure')}</AppText>) : null}
    {error ? <AppText accessibilityRole="alert" className="text-danger">{error}</AppText> : null}
    {query.isError && !data ? <ActionButton secondary label={t('common.retry')} onPress={() => void query.refetch()} /> : null}
    {data?.publishedAt ? <>
      <AppText className="text-sm text-body">{t('publish.note')}</AppText>
      <ActionButton secondary label={t('publish.stop')} busy={busy} onPress={() => void change(false)} />
    </> : data?.ready ? <ActionButton label={t('publish.action')} busy={busy} onPress={() => void change(true)} /> : null}
  </View>;
}

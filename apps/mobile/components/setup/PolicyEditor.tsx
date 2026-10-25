import { useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { TextField } from '../TextField';
import { ActionButton } from '../ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
const labels = { minimumNoticeMinutes: 'setup.minimumNotice', maximumAdvanceDays: 'setup.maximumAdvance', bufferBeforeMinutes: 'setup.bufferBefore', bufferAfterMinutes: 'setup.bufferAfter', cancellationCutoffMinutes: 'setup.cancelCutoff', rescheduleCutoffMinutes: 'setup.rescheduleCutoff' } as const;
type Policy = Record<keyof typeof labels, number>;
export function PolicyEditor({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const base = `/v1/provider/businesses/${businessId}/booking-policy`;
  const query = useQuery({ queryKey: ['provider', businessId, 'setup-policy'], queryFn: () => apiRequest<{ policy: Policy | null; defaults: Policy }>(base) });
  return query.data ? <PolicyForm initial={query.data.policy ?? query.data.defaults} businessId={businessId} base={base} /> : <View className="gap-3"><AppText>{t(query.isError ? 'setup.failure' : 'common.loading')}</AppText>{query.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void query.refetch()} /> : null}</View>;
}
function PolicyForm({ initial, businessId, base }: { initial: Policy; businessId: string; base: string }) {
  const { t } = useAppLocale(), client = useQueryClient();
  const [values, setValues] = useState(() => Object.fromEntries(Object.entries(initial).filter(([k]) => k in labels).map(([k, v]) => [k, String(v)])) as Record<keyof Policy, string>);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | 'numbers' | ''>('');
  async function save() {
    if (busy) return;
    if (Object.keys(labels).some(k => !/^\d+$/.test(values[k as keyof Policy] ?? ''))) { setFeedback('numbers'); return; }
    setBusy(true); setFeedback('');
    try { await apiRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.keys(labels).map(k => [k, Number(values[k as keyof Policy])]))) }); setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', businessId] }); }
    catch { setFeedback('error'); } finally { setBusy(false); }
  }
  return <View className="gap-4"><AppText>{t('setup.policyHint')}</AppText>{(Object.keys(labels) as (keyof Policy)[]).map(key => <TextField key={key} label={t(labels[key])} identifier keyboardType="number-pad" value={values[key]} onChangeText={value => setValues(v => ({ ...v, [key]: value }))} />)}<ActionButton label={t('setup.savePolicy')} busy={busy} onPress={() => void save()} />{feedback ? <AppText accessibilityRole={feedback === 'saved' ? 'status' : 'alert'}>{t(feedback === 'saved' ? 'setup.saved' : feedback === 'numbers' ? 'setup.numbers' : 'setup.saveFailure')}</AppText> : null}</View>;
}

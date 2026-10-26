import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import { labels, type Policy, type NumericKey } from './PolicyEditor.types';
export function usePolicyEditor({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const base = `/v1/provider/businesses/${businessId}/booking-policy`;
  const query = useQuery({ queryKey: ['provider', businessId, 'setup-policy'], queryFn: () => apiRequest<{ policy: Policy | null; defaults: Policy }>(base) });
  return { t, base, query };
}
export function usePolicyForm({ initial, businessId, base }: { initial: Policy; businessId: string; base: string }) {
  const { t } = useAppLocale(), client = useQueryClient();
  const [values, setValues] = useState<Record<NumericKey, string>>({ minimumNoticeMinutes: String(initial.minimumNoticeMinutes), maximumAdvanceDays: String(initial.maximumAdvanceDays), bufferBeforeMinutes: String(initial.bufferBeforeMinutes), bufferAfterMinutes: String(initial.bufferAfterMinutes), cancellationCutoffMinutes: String(initial.cancellationCutoffMinutes), rescheduleCutoffMinutes: String(initial.rescheduleCutoffMinutes) });
  const [requirements, setRequirements] = useState({ requireCustomerName: initial.requireCustomerName ?? false, requireVerifiedPhone: initial.requireVerifiedPhone ?? false, requireVerifiedEmail: initial.requireVerifiedEmail ?? false });
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | 'numbers' | ''>('');
  async function save() {
    if (busy) return;
    if (Object.keys(labels).some(k => !/^\d+$/.test(values[k as NumericKey] ?? ''))) { setFeedback('numbers'); return; }
    setBusy(true); setFeedback('');
    try { await apiRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(Object.keys(labels).map(k => [k, Number(values[k as NumericKey])])), ...requirements }) }); setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', businessId] }); }
    catch { setFeedback('error'); } finally { setBusy(false); }
  }
  return { t, values, setValues, requirements, setRequirements, busy, feedback, save };
}

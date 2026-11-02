import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import { policyFormValues, policyNumbers, type PolicyFormValues } from '@/src/lib/BookingPolicyForm';
import type { Policy } from './PolicyEditor.types';
export function usePolicyEditor({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const base = `/v1/provider/businesses/${businessId}/booking-policy`;
  const query = useQuery({ queryKey: ['provider', businessId, 'setup-policy'], queryFn: () => apiRequest<{ policy: Policy | null; defaults: Policy }>(base) });
  return { t, base, query };
}
export function usePolicyForm({ initial, businessId, base, onSaved }: { initial: Policy; businessId: string; base: string; onSaved?: () => void }) {
  const { t } = useAppLocale(), client = useQueryClient();
  const [values, setValues] = useState<PolicyFormValues>(() => policyFormValues(initial));
  const [requirements, setRequirements] = useState({ requireCustomerName: initial.requireCustomerName ?? false, requireVerifiedPhone: initial.requireVerifiedPhone ?? false, requireVerifiedEmail: initial.requireVerifiedEmail ?? false });
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | 'numbers' | ''>('');
  async function save() {
    if (busy) return;
    const numbers = policyNumbers(values, initial);
    if (!numbers) { setFeedback('numbers'); return; }
    setBusy(true); setFeedback('');
    try { await apiRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...numbers, ...requirements }) }); setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', businessId] }); onSaved?.(); }
    catch { setFeedback('error'); } finally { setBusy(false); }
  }
  return { t, values, setValues, requirements, setRequirements, busy, feedback, save };
}

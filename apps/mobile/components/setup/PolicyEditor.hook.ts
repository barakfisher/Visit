import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ApiError, apiRequest } from '@/src/lib/api';
import { policyFormValues, policyNumbers, policySaveFailure, VERIFIED_PHONE_UNAVAILABLE, type PolicyFormValues } from '@/src/lib/BookingPolicyForm';
import type { MessageKey } from '@/src/i18n/messages';
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
  const capabilities = useQuery({ queryKey: ['auth', 'capabilities'], queryFn: () => apiRequest<{ sms: boolean }>('/api/auth/capabilities') });
  const sms = capabilities.isError ? false : capabilities.data?.sms;
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<{ key: MessageKey; saved: boolean } | null>(null);
  async function save() {
    if (busy) return;
    const numbers = policyNumbers(values, initial);
    if (!numbers) { setFeedback({ key: 'setup.numbers', saved: false }); return; }
    setBusy(true); setFeedback(null);
    try { await apiRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...numbers, ...requirements }) }); setFeedback({ key: 'setup.saved', saved: true }); await client.invalidateQueries({ queryKey: ['provider', businessId] }); onSaved?.(); }
    catch (error) { setFeedback({ key: policySaveFailure(error), saved: false }); if (error instanceof ApiError && error.code === VERIFIED_PHONE_UNAVAILABLE) void capabilities.refetch(); } finally { setBusy(false); }
  }
  return { t, values, setValues, requirements, setRequirements, sms, busy, feedback, save };
}

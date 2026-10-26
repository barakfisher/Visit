import { useRef, useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { TextField } from '@/components/TextField';
import { apiRequest } from '@/src/lib/api';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { accessEn, accessHe } from '@/src/i18n/accessMessages';
type Case = { id: string; business: { name: string }; claimantIdentityId: string; caseReference: string; evidenceKind: string; evidenceSummary: string; status: string; reason: string | null; reviewedByIdentityId: string | null };
export default function OwnershipScreen() {
  const { locale } = useAppLocale(), m = locale === 'he' ? accessHe : accessEn;
  const queue = useQuery({ queryKey: ['admin', 'ownership-cases'], queryFn: () => apiRequest<{ cases: Case[] }>('/v1/admin/ownership-cases'), retry: false });
  const [businessId, setBusiness] = useState(''), [claimantIdentityId, setClaimant] = useState(''), [caseReference, setReference] = useState(''), [evidenceSummary, setEvidence] = useState(''), [evidenceKind, setKind] = useState('CURRENT_OWNER_CONSENT');
  const [reasons, setReasons] = useState<Record<string, string>>({}), [confirm, setConfirm] = useState(''), [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(false); const running = useRef(false);
  async function act(path: string, input: object) {
    if (running.current) return;
    running.current = true; setBusy(true); setFeedback('');
    try { await apiRequest(`/v1/admin/ownership-cases${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); setFeedback(m.decided); setConfirm(''); if (!path) { setReference(''); setEvidence(''); } await queue.refetch(); }
    catch { setFeedback(m.caseFailure); await queue.refetch(); } finally { running.current = false; setBusy(false); }
  }
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-3xl gap-5 p-6">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{m.cases}</AppText><AppText>{m.caseHint}</AppText>
    {queue.isError ? <AppText accessibilityRole="alert">{m.caseFailure}</AppText> : !queue.data ? null : <>
      <View className="gap-4 rounded-card border border-line bg-surface p-card">
        <TextField identifier label={m.businessId} value={businessId} onChangeText={setBusiness} editable={!busy} maxLength={100} /><TextField identifier label={m.claimant} value={claimantIdentityId} onChangeText={setClaimant} editable={!busy} maxLength={100} /><TextField label={m.reference} value={caseReference} onChangeText={setReference} editable={!busy} maxLength={120} />
        <AppText>{m.kind}</AppText>{[['CURRENT_OWNER_CONSENT', m.consent], ['REGISTRATION_RECORDS', m.records], ['PLATFORM_RECORDS', m.platform]].map(([key, label]) => <ActionButton key={key} secondary label={`${evidenceKind === key ? '✓ ' : ''}${label}`} disabled={busy} onPress={() => setKind(key!)} />)}
        <TextField label={m.evidence} value={evidenceSummary} onChangeText={setEvidence} multiline editable={!busy} maxLength={2000} />
        <ActionButton label={m.openCase} disabled={busy || !businessId.trim() || !claimantIdentityId.trim() || caseReference.trim().length < 5 || evidenceSummary.trim().length < 20} onPress={() => void act('', { businessId, claimantIdentityId, caseReference, evidenceKind, evidenceSummary })} />
      </View>
      {queue.data.cases.map(item => <View key={item.id} className="gap-4 rounded-card border border-line bg-surface p-card">
        <AppText className="text-xl font-semibold">{item.business.name}</AppText><AppText>{item.claimantIdentityId}</AppText><AppText>{item.caseReference} · {item.evidenceKind}</AppText><AppText>{item.evidenceSummary}</AppText><AppText>{item.status}{item.reason ? ` · ${item.reason} · ${item.reviewedByIdentityId}` : ''}</AppText>
        {item.status === 'PENDING' ? <><TextField label={m.reason} value={reasons[item.id] ?? ''} onChangeText={value => setReasons(current => ({ ...current, [item.id]: value }))} editable={!busy} maxLength={1000} />
          {confirm === item.id ? <><AppText>{m.caseHint}</AppText><ActionButton label={m.confirmGrant} disabled={busy || (reasons[item.id]?.trim().length ?? 0) < 5} onPress={() => void act(`/${item.id}/decision`, { decision: 'APPROVED', reason: reasons[item.id] })} /><ActionButton secondary label={m.cancel} onPress={() => setConfirm('')} /></> : <ActionButton label={m.approve} disabled={busy || (reasons[item.id]?.trim().length ?? 0) < 5} onPress={() => setConfirm(item.id)} />}
          <ActionButton secondary label={m.reject} disabled={busy || (reasons[item.id]?.trim().length ?? 0) < 5} onPress={() => void act(`/${item.id}/decision`, { decision: 'REJECTED', reason: reasons[item.id] })} />
        </> : null}
      </View>)}
    </>}
    {feedback ? <AppText accessibilityRole="alert">{feedback}</AppText> : null}<ActionButton secondary label={m.retry} disabled={busy} onPress={() => void queue.refetch()} /><Link href="/admin/applications">{m.back}</Link>
  </ScrollView>;
}

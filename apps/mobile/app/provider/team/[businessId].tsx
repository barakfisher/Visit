import { useRef, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { TextField } from '@/components/TextField';
import { SessionLoading } from '@/components/SessionLoading';
import { apiRequest, ApiError } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { accessEn, accessHe } from '@/src/i18n/accessMessages';
type Team = { role: string; members: { id: string; identityId: string; role: string; label: string }[]; invitations: { id: string; role: string; recipientHint: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }[] };
export default function TeamScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const identity = useSessionStore(s => s.identityId), version = useSessionStore(s => s.contextVersion);
  return <TeamContent key={`${identity}:${version}:${businessId}`} businessId={typeof businessId === 'string' ? businessId : ''} />;
}
function TeamContent({ businessId }: { businessId: string }) {
  const { locale, t } = useAppLocale(), m = locale === 'he' ? accessHe : accessEn;
  const identity = useSessionStore(s => s.identityId), bootstrap = useSessionStore(s => s.bootstrapStatus);
  const base = `/v1/provider/businesses/${encodeURIComponent(businessId)}`;
  const query = useQuery({ queryKey: ['provider', businessId, 'team'], queryFn: () => apiRequest<Team>(`${base}/team`), enabled: !!identity, retry: false });
  const [recipient, setRecipient] = useState(''), [channel, setChannel] = useState<'email' | 'phone'>('email'), [role, setRole] = useState<'MANAGER' | 'STAFF'>('STAFF'), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [link, setLink] = useState(''), [confirm, setConfirm] = useState('');
  const running = useRef(false);
  const roleLabel = (value: string) => value === 'OWNER' ? m.owner : value === 'MANAGER' ? m.manager : m.staff;
  async function act(path: string, body?: object) {
    if (running.current) return;
    running.current = true; setBusy(true); setFeedback(''); setLink('');
    try {
      const result = await apiRequest<{ url?: string }>(`${base}/${path}`, { method: body ? 'POST' : 'DELETE', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      if (result.url) setLink(result.url); setConfirm(''); await query.refetch();
    } catch (error) { setFeedback(error instanceof ApiError && error.code === 'REAUTH_REQUIRED' ? m.reauth : m.failure); await query.refetch(); }
    finally { running.current = false; setBusy(false); }
  }
  if (!identity && bootstrap !== 'ready') return <SessionLoading />;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 p-6">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{m.title}</AppText><AppText>{m.intro}</AppText>
    {!identity ? <Link href="/auth/login">{t('common.signIn')}</Link> : query.isError ? <AppText accessibilityRole="alert">{query.error instanceof ApiError && query.error.code === 'REAUTH_REQUIRED' ? m.reauth : m.failure}</AppText> : !query.data ? <AppText>{t('common.loading')}</AppText> : <>
      <View className="gap-4 rounded-card border border-line bg-surface p-card">
        <View className="flex-row gap-3"><ActionButton secondary label={m.email} disabled={busy || channel === 'email'} onPress={() => { setChannel('email'); setRecipient(''); }} /><ActionButton secondary label={m.phone} disabled={busy || channel === 'phone'} onPress={() => { setChannel('phone'); setRecipient(''); }} /></View>
        <TextField identifier label={m.recipient} value={recipient} onChangeText={setRecipient} autoCapitalize="none" keyboardType={channel === 'email' ? 'email-address' : 'phone-pad'} editable={!busy} maxLength={254} />
        <View className="flex-row gap-3">{(query.data.role === 'OWNER' ? ['STAFF', 'MANAGER'] : ['STAFF']).map(value => <ActionButton key={value} secondary label={`${role === value ? '✓ ' : ''}${roleLabel(value)}`} disabled={busy} onPress={() => setRole(value as 'STAFF' | 'MANAGER')} />)}</View>
        <ActionButton label={m.create} disabled={busy || (channel === 'phone' ? !/^\+[1-9]\d{7,14}$/.test(recipient) : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))} onPress={() => void act('invitations', { role, channel, recipient })} />
        {link ? <><AppText>{m.once}</AppText><AppText testID="private-invitation-link" selectable style={{ writingDirection: 'ltr' }}>{link}</AppText><ActionButton secondary label={m.copy} onPress={() => void Clipboard.setStringAsync(link).then(ok => setFeedback(ok ? m.copied : m.failure)).catch(() => setFeedback(m.failure))} /></> : null}
      </View>
      <AppText accessibilityRole="header" className="text-xl font-semibold">{m.members}</AppText>
      {query.data.members.map(member => <View key={member.id} testID={`team-member-${member.identityId}`} className="gap-3 rounded-card border border-line bg-surface p-card"><AppText>{roleLabel(member.role)} · {member.label}</AppText>
        {member.role !== 'OWNER' && (query.data?.role === 'OWNER' || member.role === 'STAFF') && !query.data?.members.some(other => other.identityId === member.identityId && other.role === 'OWNER') ? confirm === member.id ? <><AppText>{m.removeHint}</AppText><ActionButton label={m.confirmRemove} disabled={busy} onPress={() => void act(`members/${member.id}`)} /><ActionButton secondary label={m.cancel} onPress={() => setConfirm('')} /></> : <ActionButton secondary label={m.remove} disabled={busy} onPress={() => setConfirm(member.id)} /> : null}
      </View>)}
      <AppText accessibilityRole="header" className="text-xl font-semibold">{m.invitations}</AppText>
      {query.data.invitations.map(item => <View key={item.id} className="gap-3 rounded-card border border-line bg-surface p-card"><AppText>{item.recipientHint} · {roleLabel(item.role)}</AppText><AppText>{item.acceptedAt ? m.accepted : item.revokedAt ? m.revoked : new Date(item.expiresAt) <= new Date() ? m.expired : m.pending} · {new Date(item.expiresAt).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem' })}</AppText>{!item.acceptedAt && !item.revokedAt && (query.data?.role === 'OWNER' || item.role === 'STAFF') ? <ActionButton secondary label={m.revoke} disabled={busy} onPress={() => void act(`invitations/${item.id}`)} /> : null}</View>)}
    </>}
    {feedback ? <AppText accessibilityRole="alert">{feedback}</AppText> : null}<ActionButton secondary label={m.retry} disabled={busy} onPress={() => void query.refetch()} /><Link href={{ pathname: '/provider/[businessId]', params: { businessId } }}>{m.back}</Link>
  </ScrollView>;
}

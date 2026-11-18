import { useEffect, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView } from 'react-native';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { SessionLoading } from '@/components/SessionLoading';
import { useInvitation } from '@/src/lib/useInvitation';
import { apiRequest, ApiError } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { accessEn, accessHe } from '@/src/i18n/accessMessages';
import type { AuthProfile } from '@/src/types/flows';
import { INVITATION_OWNER_LINK, INVITATION_STAFF_LINKED, INVITATION_STAFF_REMOVED, isApiCode } from '@/src/lib/StaffAccess';
type Preview = { business: { name: string }; role: string; staff: { displayName: string } | null };
const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
export default function InvitationScreen() {
  const { locale, t } = useAppLocale(), m = locale === 'he' ? accessHe : accessEn;
  const { token, clear } = useInvitation();
  const identity = useSessionStore(s => s.identityId), bootstrap = useSessionStore(s => s.bootstrapStatus);
  const initialIdentity = useRef(identity), running = useRef(false);
  const [preview, setPreview] = useState<(Preview & { token: string }) | null>(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [done, setDone] = useState(false);
  useEffect(() => {
    if (initialIdentity.current && initialIdentity.current !== identity) { clear(); setPreview(null); setFeedback(''); setDone(false); }
    initialIdentity.current = identity;
  }, [identity, clear]);
  async function act(accept: boolean) {
    if (running.current || !identity || !token) return;
    running.current = true; setBusy(true); setFeedback('');
    const expected = identity;
    try {
      const result = await apiRequest<Preview>(`/v1/business-invitations/${accept ? 'accept' : 'preview'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (useSessionStore.getState().identityId !== expected) return;
      if (accept) {
        clear(); setDone(true); setPreview({ ...result, token });
        try {
          const { profile } = await apiRequest<{ profile: AuthProfile }>('/api/auth/me');
          if (profile.id === expected) useSessionStore.getState().setAuth(useSessionStore.getState().token, profile);
        } catch { setFeedback(m.profileRefresh); }
      } else setPreview({ ...result, token });
    } catch (error) { if (accept && !useSessionStore.getState().identityId) return; setPreview(null); setFeedback(error instanceof ApiError && error.code === 'REAUTH_REQUIRED' ? m.reauth : isApiCode(error, INVITATION_STAFF_REMOVED) ? m.staffRemoved : isApiCode(error, INVITATION_STAFF_LINKED) ? m.staffLinked : isApiCode(error, INVITATION_OWNER_LINK) ? m.ownerLink : m.unavailable); }
    finally { running.current = false; setBusy(false); }
  }
  if (!identity && bootstrap !== 'ready') return <SessionLoading />;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 p-6">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{m.inviteTitle}</AppText><AppText>{m.inviteHint}</AppText>
    {!identity ? <><AppText>{m.reopen}</AppText><Link href="/auth/login">{t('common.signIn')}</Link></> : done && !token ? <><AppText role="status">{m.success}</AppText>{preview?.staff ? <AppText>{fill(m.workerHint, { staff: preview.staff.displayName })}</AppText> : preview?.role === 'STAFF' ? <AppText>{m.staffHint}</AppText> : null}</> : !token ? <AppText>{m.missing}</AppText> : <>
      {preview?.token === token ? <>{preview.staff ? <AppText testID="invitation-join-as" className="text-xl font-semibold">{fill(m.joinAs, { business: preview.business.name, staff: preview.staff.displayName })}</AppText> : <AppText className="text-xl font-semibold">{preview.business.name}</AppText>}<AppText>{preview.role === 'MANAGER' ? m.manager : m.staff}</AppText><ActionButton label={m.accept} disabled={busy} onPress={() => void act(true)} /></> : <ActionButton label={m.preview} disabled={busy} onPress={() => void act(false)} />}
    </>}
    {feedback ? <AppText accessibilityRole="alert">{feedback}</AppText> : null}<Link href="/">{m.home}</Link>
  </ScrollView>;
}

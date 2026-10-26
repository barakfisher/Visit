import { safeAuthReturnTo } from '@visit/contracts';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest, ApiError } from '@/src/lib/api';
import { refreshAccountAfterChange } from '@/src/lib/auth';
import { useSessionStore } from '@/src/state/session';
import type { Method, Methods, Issued } from './AccountMethods.types';
export function useAccountMethods({ onBusyChange, contactOnly = false, returnTo, onReauthenticate }: { onBusyChange?: (busy: boolean) => void; contactOnly?: boolean; returnTo?: string; onReauthenticate?: () => void }) {
  const { t, locale } = useAppLocale();
  const identityId = useSessionStore(state => state.identityId);
  const methods = useQuery({ queryKey: ['account-methods', identityId], queryFn: async () => { const result = await apiRequest<Methods>('/api/account/sign-in-methods'); if (result.identityId !== identityId) throw new ApiError('The signed-in account changed.', 'SESSION_CHANGED', 409); return result; }, enabled: Boolean(identityId), refetchOnMount: 'always', refetchInterval: 30000 });
  const capabilities = useQuery({ queryKey: ['auth', 'capabilities'], queryFn: () => apiRequest<{ google: boolean; googleNative: boolean }>('/api/auth/capabilities') });
  const [channel, setChannel] = useState<'email' | 'phone'>('email'), [destination, setDestination] = useState('');
  const [challenge, setChallenge] = useState(''), [code, setCode] = useState(''), [cooldown, setCooldown] = useState(0);
  const [removing, setRemoving] = useState<Method | null>(null), [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(false);
  const reauth = methods.data?.reauthRequired ?? true;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  function failure(reason: unknown) {
    if (reason instanceof ApiError) {
      if (reason.code === 'REAUTH_REQUIRED' || reason.status === 401) { void methods.refetch(); return t('methods.reauth'); }
      if (reason.code === 'METHOD_UNAVAILABLE') return t('methods.conflict');
      if (reason.code === 'LAST_LOGIN_METHOD') return t('methods.last');
      if (reason.status === 429) return t('email.rateLimited');
    }
    return t('methods.failure');
  }
  function resetDraft() { setChallenge(''); setCode(''); setRemoving(null); setError(''); }
  async function start() {
    setBusy(true); setError(''); setSuccess(false);
    try {
      const result = await apiRequest<{ challenge: string; resendAfterSeconds: number }>('/api/account/contact-challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, destination, consent: true }) });
      setChallenge(result.challenge); setCode(''); setCooldown(result.resendAfterSeconds);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  async function finish(remove?: Method) {
    setBusy(true); setError(''); setSuccess(false);
    try {
      let result = issued;
      if (!result) {
        result = await apiRequest<Issued>(remove ? '/api/account/sign-in-methods/remove' : '/api/account/contact-challenges/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(remove ? { method: remove.method, ...(remove.method === 'google' ? { id: remove.id } : {}), consent: true } : { challenge, code, consent: true }) });
        setIssued(result); setChallenge(''); setCode(''); // Preserve replacement across profile failure; never replay the proof.
      }
      await refreshAccountAfterChange(result);
      setIssued(null); setRemoving(null); setDestination(''); setSuccess(true);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  async function loadLocalCode() {
    setBusy(true); setError('');
    try { const result = await apiRequest<{ code: string }>('/__dev/account/contact-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge }) }); setCode(result.code); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  const available = methods.data?.capabilities[channel] ?? false;
  const valid = channel === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination.trim()) : /^\+[1-9]\d{7,14}$/.test(destination.trim().replace(/[\s()-]/g, ''));
  const reauthReturnTo = safeAuthReturnTo(returnTo);
  return { reauthReturnTo, onReauthenticate, t, locale, identityId, methods, capabilities, channel, setChannel, destination, setDestination, challenge, code, setCode, cooldown, removing, setRemoving, issued, busy, error, setError, success, reauth, resetDraft, start, finish, loadLocalCode, available, valid, contactOnly };
}

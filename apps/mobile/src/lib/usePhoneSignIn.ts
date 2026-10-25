import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from './api';
import { completeSignIn } from './auth';
import { useAppLocale } from '@/src/i18n/LocaleContext';

type Issued = { sessionToken?: string; profile: { id: string } };
type Timing = { resendAfterSeconds: number; expiresInSeconds: number };
export function usePhoneSignIn(returnTo?: string) {
  const { t } = useAppLocale();
  const [phone, setPhone] = useState(''), [code, setCode] = useState('');
  const [sent, setSent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [timing, setTiming] = useState({ resendAt: 0, expiresAt: 0 }), [now, setNow] = useState(Date.now);
  const [issued, setIssued] = useState<Issued | null>(null);
  const operation = useRef(false), mounted = useRef(true), issuedRef = useRef<Issued | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if ((!timing.resendAt && !timing.expiresAt) || issued) return;
    const timer = setInterval(() => {
      const current = Date.now(); setNow(current);
      if (current >= Math.max(timing.resendAt, timing.expiresAt)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [timing, issued]);
  const cooldown = Math.max(0, Math.ceil((timing.resendAt - now) / 1000));
  const remaining = Math.max(0, Math.ceil((timing.expiresAt - now) / 1000));
  function failure(reason: unknown) {
    return t(reason instanceof ApiError && reason.status === 429 ? 'auth.rateLimited' : reason instanceof ApiError && reason.status === 401 ? 'auth.invalidCode' : 'auth.failure');
  }
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await action(); } catch (reason) { if (mounted.current) setError(failure(reason)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function send() {
    if (cooldown || issuedRef.current) return;
    await run(async () => {
      const result = await apiRequest<Timing>('/api/auth/otp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      if (!mounted.current) return;
      const current = Date.now(); setNow(current);
      setTiming({ resendAt: current + result.resendAfterSeconds * 1000, expiresAt: current + result.expiresInSeconds * 1000 });
      setSent(true); setCode('');
    });
  }
  async function verify() {
    if (!issuedRef.current && (!remaining || code.length !== 6)) return;
    await run(async () => {
      let session = issuedRef.current;
      if (!session) {
        session = await apiRequest<Issued>('/api/auth/otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) });
        // Preserve the issued result before any subsequent profile request. A retry
        // must not redeem a consumed OTP a second time, including native token recovery.
        issuedRef.current = session;
        if (!mounted.current) return;
        setIssued(session); setCode('');
      }
      if (mounted.current) await completeSignIn(session.sessionToken, returnTo, session.profile.id, () => mounted.current);
    });
  }
  function reset() {
    if (operation.current) return;
    issuedRef.current = null; setIssued(null); setSent(false); setCode(''); setError('');
    // Keep resend timing when changing/restarting; the server owns all quotas.
  }
  return { phone, setPhone, code, setCode, sent, busy, error, issued: !!issued, cooldown, remaining, send, verify, reset };
}

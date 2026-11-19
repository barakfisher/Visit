import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from './api';
import { completeSignIn } from './auth';
import { isEmail, PASSWORD_MIN_LENGTH, type Issued } from './PasswordSignIn.hook';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import type { PasswordSignInView, SignUpCodeView } from '../types/PasswordSignIn.types';

type Pending = { pendingId: string; resendAfterSeconds: number; expiresInSeconds: number };
// Sign-up sends a code and creates the account only when the code is right. The server answers the same for a
// registered address, so the app always shows the code step (login-plan-stage-2.md, slice 1).
export function usePasswordSignUp(returnTo?: string): { step: 'form' | 'code'; form: PasswordSignInView; code: SignUpCodeView } {
  const { t, locale } = useAppLocale();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [displayName, setDisplayName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null), [sentTo, setSentTo] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [ended, setEnded] = useState(false), [accountExists, setAccountExists] = useState(false);
  const [cooldown, setCooldown] = useState(0), [issued, setIssued] = useState(false), [localNotice, setLocalNotice] = useState('');
  const operation = useRef(false), mounted = useRef(true), session = useRef<Issued | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  const canSubmit = isEmail(email) && password.length >= PASSWORD_MIN_LENGTH && displayName.trim().length >= 2;
  function failure(reason: unknown) {
    if (!(reason instanceof ApiError)) return t('password.unavailable');
    if (reason.code === 'SIGN_UP_CODE_INVALID') return t('signUp.codeInvalid');
    if (reason.code === 'SIGN_UP_TOO_MANY_ATTEMPTS') return t('signUp.tooManyAttempts');
    if (reason.code === 'SIGN_UP_EXPIRED') return t('signUp.expired');
    if (reason.code === 'ACCOUNT_EXISTS') return t('signUp.accountExists');
    if (reason.code === 'EMAIL_DELIVERY_FAILED') return t('signUp.deliveryFailed');
    if (reason.code === 'METHOD_NOT_CONFIGURED') return t('signUp.notConfigured');
    if (reason.code === 'VALIDATION_ERROR') return t('password.invalidInput');
    if (reason.status === 429) return t('password.rateLimited');
    return t('password.unavailable');
  }
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setLocalNotice('');
    try { await action(); } catch (reason) {
      if (!mounted.current) return;
      setError(failure(reason));
      if (reason instanceof ApiError && ['SIGN_UP_TOO_MANY_ATTEMPTS', 'SIGN_UP_EXPIRED', 'ACCOUNT_EXISTS'].includes(reason.code ?? '')) { setEnded(true); setAccountExists(reason.code === 'ACCOUNT_EXISTS'); }
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  const started = (result: Pending, address: string) => { setPending(result); setSentTo(address); setCode(''); setEnded(false); setAccountExists(false); setCooldown(result.resendAfterSeconds); };
  const submit = () => { if (!canSubmit) return; void run(async () => {
    const address = email.trim();
    const result = await apiRequest<Pending>('/v1/auth/password/sign-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: address, password, displayName, locale }) });
    if (mounted.current) started(result, address);
  }); };
  const resend = () => { if (!pending || cooldown > 0 || ended) return; void run(async () => {
    const result = await apiRequest<Pending>('/v1/auth/password/sign-up/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingId: pending.pendingId }) });
    if (mounted.current) started({ ...result, pendingId: pending.pendingId }, sentTo);
  }); };
  const verify = () => { if (!pending || (!session.current && (code.length !== 6 || ended))) return; void run(async () => {
    let issuedSession = session.current;
    if (!issuedSession) {
      issuedSession = await apiRequest<Issued>('/v1/auth/password/sign-up/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingId: pending.pendingId, code }) });
      // The code is spent; a retry after a failed profile load resumes this session instead of verifying again.
      session.current = issuedSession; if (mounted.current) setIssued(true);
    }
    if (mounted.current) await completeSignIn(issuedSession.sessionToken, returnTo, issuedSession.identity.id, () => mounted.current);
  }); };
  // Back to the form with every field kept; the next submit starts a new pending sign-up.
  const changeAddress = () => { if (operation.current || session.current) return; setPending(null); setCode(''); setError(''); setEnded(false); setAccountExists(false); setLocalNotice(''); };
  // Development builds only: reads the local inbox through the loopback helper.
  const loadLocalCode = () => { if (!pending) return; void run(async () => {
    const result = await apiRequest<{ code?: string; existingAccount?: boolean }>('/__dev/auth/sign-up-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingId: pending.pendingId }) });
    if (!mounted.current) return;
    if (result.code) setCode(result.code); else setLocalNotice(t('signUp.localExistingAccount'));
  }); };
  return {
    step: pending ? 'code' : 'form',
    form: { mode: 'sign-up', email, password, displayName, busy, error: pending ? '' : error, canSubmit, setEmail, setPassword, setDisplayName, submit },
    code: { email: sentTo, code, busy, error: pending ? error : '', ended, accountExists, cooldown, issued, localNotice, setCode, verify, resend, changeAddress, loadLocalCode },
  };
}

import { useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import { completeSignIn } from './auth';
import { passwordFailure, signUpNeedsNewCode, SIGN_UP_CODE_LENGTH } from './PasswordSignUp';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import type { PasswordMode, PasswordSignInView } from '../types/PasswordSignIn.types';

// Mirrors the server's rules so the button enables only for a request the server accepts.
export const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Issued = { sessionToken?: string; identity: { id: string } };
type Started = { signUp: string; expiresInSeconds: number; resendAfterSeconds: number };
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Sign-in is one request. Sign-up is two steps on the same screen: the form sends a code to the address,
 * and the code creates the account. The pending sign-up's handle lives only in this hook's memory, never
 * in the URL or storage, so leaving or reloading the screen starts over.
 */
export function usePasswordSignIn(mode: PasswordMode, returnTo?: string): PasswordSignInView {
  const { t, locale } = useAppLocale();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [resumable, setResumable] = useState(false);
  const [pending, setPending] = useState<{ handle: string; email: string } | null>(null), [code, setCode] = useState('');
  const [refused, setRefused] = useState(false), [timing, setTiming] = useState({ resendAt: 0, expiresAt: 0 }), [now, setNow] = useState(Date.now);
  const operation = useRef(false), mounted = useRef(true), issued = useRef<Issued | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!pending || resumable) return;
    const timer = setInterval(() => {
      const current = Date.now(); setNow(current);
      if (current >= Math.max(timing.resendAt, timing.expiresAt)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, timing, resumable]);
  const cooldown = Math.max(0, Math.ceil((timing.resendAt - now) / 1000)), remaining = Math.max(0, Math.ceil((timing.expiresAt - now) / 1000));
  const canSubmit = EMAIL_PATTERN.test(email.trim()) && password.length >= PASSWORD_MIN_LENGTH && (mode === 'sign-in' || displayName.trim().length >= 2);

  async function run(action: () => Promise<void>, onError?: (reason: unknown) => void) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { if (mounted.current) { setError(t(passwordFailure(reason))); onError?.(reason); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  // A retry after a failed profile load resumes the issued session; it never creates a second account.
  async function finish(session: Issued) {
    issued.current = session; if (mounted.current) setResumable(true);
    if (mounted.current) await completeSignIn(session.sessionToken, returnTo, session.identity.id, () => mounted.current);
  }
  async function sendCode() {
    const started = await apiRequest<Started>('/v1/auth/password/sign-up', json({ email, password, displayName, locale }));
    if (!mounted.current) return;
    const current = Date.now(); setNow(current);
    setTiming({ resendAt: current + started.resendAfterSeconds * 1000, expiresAt: current + started.expiresInSeconds * 1000 });
    setPending({ handle: started.signUp, email: email.trim().toLowerCase() }); setCode(''); setRefused(false);
  }
  function submit() {
    if (issued.current) { void run(() => finish(issued.current!)); return; }
    if (!canSubmit) return;
    if (mode === 'sign-up') { void run(sendCode); return; }
    void run(async () => finish(await apiRequest<Issued>('/v1/auth/password/sign-in', json({ email, password }))));
  }
  function verify() {
    if (issued.current) { void run(() => finish(issued.current!)); return; }
    if (!pending || refused || !remaining || code.length !== SIGN_UP_CODE_LENGTH) return;
    void run(async () => finish(await apiRequest<Issued>('/v1/auth/password/sign-up/verify', json({ signUp: pending.handle, code }))), reason => {
      setCode('');
      if (signUpNeedsNewCode(reason, remaining)) setRefused(true);
    });
  }
  function resend() { if (!issued.current && !cooldown) void run(sendCode); }
  function changeEmail() {
    if (operation.current || issued.current) return;
    setPending(null); setCode(''); setRefused(false); setError('');
  }
  const codeStep = mode === 'sign-up' && pending ? { email: pending.email, code, cooldown, remaining, needsNewCode: refused || !remaining, issued: resumable, setCode, verify, resend, changeEmail } : null;
  return { mode, email, password, displayName, busy, error, canSubmit: canSubmit || resumable, setEmail, setPassword, setDisplayName, submit, codeStep };
}

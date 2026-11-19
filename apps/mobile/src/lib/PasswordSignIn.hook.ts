import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from './api';
import { completeSignIn } from './auth';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import type { PasswordMode, PasswordSignInView } from '../types/PasswordSignIn.types';

// Mirrors the server's rules so the button enables only for a request the server accepts.
export const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string) => EMAIL_PATTERN.test(value.trim());
export type Issued = { sessionToken?: string; identity: { id: string } };
export function usePasswordSignIn(returnTo?: string): PasswordSignInView {
  const mode: PasswordMode = 'sign-in';
  const { t } = useAppLocale();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [resumable, setResumable] = useState(false);
  const operation = useRef(false), mounted = useRef(true), issued = useRef<Issued | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canSubmit = isEmail(email) && password.length >= PASSWORD_MIN_LENGTH;
  function failure(reason: unknown) {
    if (!(reason instanceof ApiError)) return t('password.unavailable');
    if (reason.code === 'INVALID_CREDENTIALS') return t('password.invalid');
    if (reason.code === 'VALIDATION_ERROR') return t('password.invalidInput');
    if (reason.status === 429) return t('password.rateLimited');
    return t('password.unavailable');
  }
  async function submit() {
    if (operation.current || (!issued.current && !canSubmit)) return;
    operation.current = true; setBusy(true); setError('');
    try {
      let session = issued.current;
      if (!session) {
        session = await apiRequest<Issued>('/v1/auth/password/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        // A retry after a failed profile load resumes this session instead of signing in again.
        issued.current = session; if (mounted.current) setResumable(true);
      }
      if (mounted.current) await completeSignIn(session.sessionToken, returnTo, session.identity.id, () => mounted.current);
    } catch (reason) { if (mounted.current) setError(failure(reason)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  return { mode, email, password, displayName, busy, error, canSubmit: canSubmit || resumable, setEmail, setPassword, setDisplayName, submit: () => void submit() };
}

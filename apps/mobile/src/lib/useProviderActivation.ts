/* eslint-disable react-hooks/set-state-in-effect -- Reflect focused app/session changes and the external idempotent save operation. */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useAuthStore } from '../state/auth';
import { apiRequest, ApiError } from './api';
import { queryClient } from './queryClient';
type Target = { slug: string } | { businessId: string };
type Result = { provider: { id: string; name: string; slug: string } };
// A focused, visible activation is a client POST, never a GET/prefetch side effect.
export function useProviderActivation(target: Target | undefined, onSaved?: (result: Result) => void) {
  const identity = useAuthStore(s => s.identityId), version = useAuthStore(s => s.contextVersion);
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'changed'>('idle');
  const [attempt, setAttempt] = useState(0);
  const owner = useRef<{ identity: string; version: number } | null>(null);
  const operation = useRef<{ key: string; promise: Promise<Result> } | null>(null);
  const key = target ? JSON.stringify(target) : '';
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setActive(state === 'active')); return () => subscription.remove(); }, []);
  useEffect(() => {
    if (!focused || !active || !identity || !key) return;
    const before = owner.current;
    if (before && (before.identity !== identity || before.version !== version)) {
      // A retained route cannot reuse an old account's pending activation.
      setStatus('changed'); return;
    }
    owner.current ??= { identity, version };
    const selector = JSON.parse(key) as Target;
    if ('businessId' in selector && queryClient.getQueryData(['my-provider-saved', identity, selector.businessId]) === true) { setStatus('saved'); return; }
    let current = true;
    setStatus('saving');
    const operationKey = `${key}:${identity}:${version}:${attempt}`;
    if (operation.current?.key !== operationKey) operation.current = { key: operationKey, promise: apiRequest<Result>('/api/me/providers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visit-Expected-Identity': identity }, body: key }) };
    operation.current.promise.then(result => {
      const session = useAuthStore.getState();
      if (!current || session.identityId !== identity || session.contextVersion !== version) return;
      queryClient.setQueryData(['my-provider-saved', identity, result.provider.id], true);
      setStatus('saved'); void queryClient.invalidateQueries({ queryKey: ['my-providers', identity] }); onSaved?.(result);
    }).catch(error => { if (current) setStatus(error instanceof ApiError && error.code === 'SESSION_CHANGED' ? 'changed' : 'error'); });
    return () => { current = false; };
  }, [focused, active, identity, version, key, attempt, onSaved]);
  return { status, retry: () => setAttempt(value => value + 1) };
}

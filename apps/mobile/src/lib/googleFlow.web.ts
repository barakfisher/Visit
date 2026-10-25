import { useEffect, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { apiRequest } from './api';
import { googleAuthorizationUrl, parseGoogleCallback, safeGoogleReturnTo, type GoogleReceipt, type GoogleStart } from './googleCallback';
const returnKey = 'visit.google.returnTo'; // Navigation hint only; no proofs or tokens persisted.
export function googleNativeAvailable() { return true; }
export async function beginGoogleSignIn({ intent = 'login', returnTo }: GoogleStart = {}) {
  const result = await apiRequest<{ authorizationUrl: string }>('/api/auth/google/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'web', intent, ...(intent === 'link' ? { consent: true } : {}) }) });
  const destination = googleAuthorizationUrl(result.authorizationUrl);
  try { sessionStorage.removeItem(returnKey); const target = safeGoogleReturnTo(returnTo); if (target) sessionStorage.setItem(returnKey, target); } catch { /* Storage is optional. */ }
  window.location.assign(destination);
}
// Keep the received handoff across Router's replacement of the callback URL.
// No browser storage, route params or history entry contains the retained proof.
let receipt: GoogleReceipt | null = null;
const listeners = new Set<() => void>();
function publish(value: GoogleReceipt) { receipt = value; listeners.forEach(listener => listener()); }
export function useGoogleReceipt() {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => receipt, () => null);
  useEffect(() => {
    const receive = () => {
      const url = new URL(window.location.href);
      if (!url.hash && receipt) return;
      const parsed = parseGoogleCallback(url.href, `${window.location.origin}/auth/google`);
      let returnTo: string | undefined;
      try { returnTo = safeGoogleReturnTo(sessionStorage.getItem(returnKey) ?? undefined); sessionStorage.removeItem(returnKey); } catch { /* Optional hint. */ }
      publish('grant' in parsed ? { ...parsed, returnTo } : parsed);
      // Replacing also removes React Navigation's original route path, which can
      // restore an initial fragment after a setParams-only scrub on hard navigation.
      window.history.replaceState(window.history.state, '', '/auth/google');
      router.replace('/auth/google');
    };
    receive(); window.addEventListener('hashchange', receive);
    return () => window.removeEventListener('hashchange', receive);
  }, []);
  return { receipt: value, clear: () => publish({ status: 'invalid' }) };
}

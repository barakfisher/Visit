import { safeAuthReturnTo } from '@visit/contracts';
import { router, type Href } from 'expo-router';
import { ApiError, apiRequest } from './api';
import { readSessionToken, saveSessionToken } from './sessionToken';
import { useAuthStore } from '../state/auth';
import type { AuthProfile } from '../types/flows';
export async function completeSignIn(sessionToken?: string, returnTo?: string, expectedIdentityId?: string, isCurrent: () => boolean = () => true) {
  if (sessionToken) await saveSessionToken(sessionToken);
  const { profile } = await apiRequest<{ profile: AuthProfile }>('/api/auth/me');
  if (!isCurrent()) return;
  if (expectedIdentityId && profile.id !== expectedIdentityId) throw new ApiError('The signed-in account changed. Please retry sign-in.', 'SESSION_CHANGED', 409);
  useAuthStore.getState().setAuth(sessionToken ?? null, profile);
  const target = safeAuthReturnTo(returnTo) ?? '/';
  router.replace(target as Href);
}

export async function signOut() {
  try { await apiRequest('/v1/auth/logout', { method: 'POST' }); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  await saveSessionToken(null);
  useAuthStore.getState().clear();
  router.replace('/auth/login');
}


export async function refreshAccountAfterChange(result: { sessionToken?: string; identity: { id: string } }) {
  if (result.sessionToken) await saveSessionToken(result.sessionToken);
  const { profile } = await apiRequest<{ profile: AuthProfile }>('/api/auth/me');
  if (profile.id !== result.identity.id || (useAuthStore.getState().identityId && useAuthStore.getState().identityId !== result.identity.id)) throw new ApiError('The signed-in account changed. Please retry sign-in.', 'SESSION_CHANGED', 409);
  useAuthStore.getState().resetAuthContext(await readSessionToken(), profile);
}

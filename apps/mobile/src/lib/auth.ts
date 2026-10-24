import { router, type Href } from 'expo-router';
import { ApiError, apiRequest } from './api';
import { saveSessionToken } from './sessionToken';
import { useAuthStore } from '../state/auth';
import type { AuthProfile } from '../types/flows';
export async function completeSignIn(sessionToken?: string, returnTo?: string) {
  if (sessionToken) await saveSessionToken(sessionToken);
  const { profile } = await apiRequest<{ profile: AuthProfile }>('/api/auth/me');
  useAuthStore.getState().setAuth(sessionToken ?? null, profile);
  const target = returnTo && /^\/(booking\/|discover(?:\?|$))/.test(returnTo) && !returnTo.includes('://') ? returnTo : profile.is_provider ? '/provider/dashboard' : '/discover';
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

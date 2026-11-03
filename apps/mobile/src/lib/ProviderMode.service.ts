import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { apiRequest } from './api';
import { useSessionStore } from '../state/session';
import type { AuthProfile } from '../types/flows';
import { PROVIDER_MODE_KEY, parseProviderMode, type RememberedProviderMode } from './ProviderMode';
// Storage can fail (private browsing, full disk); provider mode then simply is not remembered.
export async function readProviderMode(): Promise<RememberedProviderMode | null> {
  try { return parseProviderMode(await AsyncStorage.getItem(PROVIDER_MODE_KEY)); } catch { return null; }
}
export async function forgetProviderMode() { try { await AsyncStorage.removeItem(PROVIDER_MODE_KEY); } catch { /* nothing to undo */ } }
async function rememberProviderMode(value: RememberedProviderMode) { try { await AsyncStorage.setItem(PROVIDER_MODE_KEY, JSON.stringify(value)); } catch { /* not remembered */ } }
/** Re-reads the profile, then opens the business's workspace. Returns false when the account or its access changed meanwhile. */
export async function openProviderWorkspace(businessId: string): Promise<boolean> {
  const expected = useSessionStore.getState().identityId;
  const { profile } = await apiRequest<{ profile: AuthProfile }>('/api/auth/me');
  const state = useSessionStore.getState();
  if (!expected || profile.id !== expected || state.identityId !== expected || !profile.businesses.some(b => b.id === businessId)) return false;
  state.setAuth(state.token, profile);
  state.selectBusiness(businessId);
  await rememberProviderMode({ identityId: expected, businessId });
  router.replace({ pathname: '/provider/dashboard', params: { businessId } });
  return true;
}

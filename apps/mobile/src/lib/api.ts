import { Platform } from 'react-native';
import { readSessionToken, saveSessionToken } from './sessionToken';
import { useSessionStore } from '../state/session';
import { createApiClient } from './apiClient';
import { apiAddress } from './apiAddress';
import { streamingFetch } from './streamingFetch';

export { ApiError } from './apiClient';
export const apiRequest = createApiClient({
  // Each variable is read by its full name: Expo inlines EXPO_PUBLIC_* values only where they are written out.
  baseUrl: apiAddress(Platform.OS, { api: process.env.EXPO_PUBLIC_API_URL, web: process.env.EXPO_PUBLIC_WEB_API_URL }),
  native: Platform.OS !== 'web',
  streamingFetch,
  readToken: readSessionToken,
  saveToken: saveSessionToken,
  clearSession: () => useSessionStore.getState().clear(),
  onProviderForbidden: () => useSessionStore.getState().invalidateProviderAccess(),
  contextVersion: () => useSessionStore.getState().contextVersion,
});

export type HealthResponse = {
  status: 'ready' | 'not_ready';
  database: 'ok' | 'unavailable';
  redis: 'ok' | 'unavailable';
};

import { Platform } from 'react-native';
import { readSessionToken, saveSessionToken } from './sessionToken';
import { useSessionStore } from '../state/session';
import { createApiClient } from './apiClient';

export { ApiError } from './apiClient';
export const apiRequest = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  native: Platform.OS !== 'web',
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

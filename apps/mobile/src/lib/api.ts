import { Platform } from 'react-native';
import { readSessionToken, saveSessionToken } from './sessionToken';
import { useSessionStore } from '../state/session';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function send(path: string, init: RequestInit | undefined, token: string | null) {
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers: { Accept: 'application/json', ...(Platform.OS !== 'web' ? { 'X-Visit-Client': 'native' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
    credentials: 'include',
  });
}

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const token = await readSessionToken();
      const response = await send('/v1/auth/refresh', { method: 'POST' }, token);
      if (!response.ok) {
        await saveSessionToken(null);
        useSessionStore.getState().clear();
        return false;
      }
      const body = await response.json() as { sessionToken?: string };
      if (body.sessionToken) await saveSessionToken(body.sessionToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await send(path, init, await readSessionToken());
    if (response.status === 401 && !path.startsWith('/v1/auth/') && !path.startsWith('/api/auth/') && await refreshSession()) response = await send(path, init, await readSessionToken());
  } catch {
    throw new ApiError('The service could not be reached. Check your connection and retry.', 'NETWORK_ERROR', 0);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiError(error?.message ?? 'The request could not be completed.', error?.code ?? 'REQUEST_FAILED', response.status, error?.fields);
  }
  return body as T;
}

export type HealthResponse = {
  status: 'ready' | 'not_ready';
  database: 'ok' | 'unavailable';
  redis: 'ok' | 'unavailable';
};

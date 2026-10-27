import { apiRequest } from './api';
import type { SavedProviderPage } from '../types/Home.types';
export function readSavedProviders(cursor: string | null, signal?: AbortSignal) {
  return apiRequest<SavedProviderPage>(`/api/me/providers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
}
export function removeSavedProvider(businessId: string, identity: string) {
  return apiRequest(`/api/me/providers/${encodeURIComponent(businessId)}`, { method: 'DELETE', headers: { 'X-Visit-Expected-Identity': identity } });
}

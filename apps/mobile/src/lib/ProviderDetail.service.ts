import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../state/auth';
import { apiRequest } from './api';
import type { ProviderDetail } from '../types/flows';

/** The published business as a customer sees it. The key is the booking screen's, so the business page and booking share one read. */
export function useProviderDetail(providerId: string, enabled = true) {
  const identityId = useAuthStore(state => state.identityId), contextVersion = useAuthStore(state => state.contextVersion);
  return useQuery({ queryKey: ['provider', identityId, contextVersion, providerId, 'public'], queryFn: ({ signal }) => apiRequest<{ provider: ProviderDetail }>(`/api/providers/${encodeURIComponent(providerId)}`, { signal }), enabled: enabled && Boolean(providerId) });
}

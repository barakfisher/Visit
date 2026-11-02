import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { BusinessReadiness } from './BusinessReadiness';

// Every setup save invalidates ['provider', businessId], so this refreshes without polling or a refresh button.
export function useBusinessReadiness(businessId: string, enabled = true) {
  return useQuery({ queryKey: ['provider', businessId, 'publication'], queryFn: () => apiRequest<BusinessReadiness>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/publication`), enabled });
}

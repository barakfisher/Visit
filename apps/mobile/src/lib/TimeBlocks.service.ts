import { apiRequest } from './api';
import type { TimeBlock, TimeBlockInput, TimeBlockList } from '../types/TimeBlocks.types';
export function readTimeBlocks(businessId: string, signal?: AbortSignal) { return apiRequest<TimeBlockList>(`/api/provider/block-time?${new URLSearchParams({ businessId })}`, { signal }); }
export function createTimeBlock(input: TimeBlockInput) { return apiRequest<TimeBlock>('/api/provider/block-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function removeTimeBlock(businessId: string, id: string) { return apiRequest(`/api/provider/block-time/${encodeURIComponent(id)}?${new URLSearchParams({ businessId })}`, { method: 'DELETE' }); }

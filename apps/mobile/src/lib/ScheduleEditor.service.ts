import { apiRequest } from './api';
import type { SchedulePreview, ScheduleProposal, ScheduleRules } from '../types/ScheduleEditor.types';
export function scheduleEndpoint(businessId: string, staffId?: string) { return `/v1/provider/businesses/${encodeURIComponent(businessId)}${staffId ? `/staff/${encodeURIComponent(staffId)}` : ''}/availability-rules`; }
export function readSchedule(businessId: string, staffId?: string, signal?: AbortSignal) { return apiRequest<ScheduleRules>(scheduleEndpoint(businessId, staffId), { signal }); }
export function previewSchedule(businessId: string, staffId: string | undefined, proposal: ScheduleProposal) { return apiRequest<SchedulePreview>(scheduleEndpoint(businessId, staffId) + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proposal) }); }
export function saveSchedule(businessId: string, staffId: string | undefined, proposal: ScheduleProposal, token: string) { return apiRequest(scheduleEndpoint(businessId, staffId), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Visit-Schedule-Preview': token }, body: JSON.stringify(proposal) }); }

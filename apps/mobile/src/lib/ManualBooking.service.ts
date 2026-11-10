import { apiRequest } from './api';
import type { ManualInput, ManualOptions, ManualResult } from '../types/ManualBooking.types';
const root = (id: string) => `/v1/provider/businesses/${encodeURIComponent(id)}`;
export function readManualOptions(businessId: string, signal?: AbortSignal) { return apiRequest<ManualOptions>(root(businessId) + '/manual-booking-options', { signal }); }
export function submitManualBooking(businessId: string, input: ManualInput, identity: string) { return apiRequest<ManualResult>(root(businessId) + '/manual-bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visit-Expected-Identity': identity }, body: JSON.stringify(input) }); }

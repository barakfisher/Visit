import { apiRequest } from './api';
import type { PastAppointmentsPage } from '../types/PastAppointments.types';

/** One page of past appointments, newest first; the cursor is the server's, passed back untouched. */
export function readPastAppointments(cursor: string | null, businessId: string | undefined, signal?: AbortSignal) {
  const query = new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(businessId ? { businessId } : {}) }).toString();
  return apiRequest<PastAppointmentsPage>(`/v1/me/bookings/history${query ? `?${query}` : ''}`, { signal });
}

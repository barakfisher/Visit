import { apiRequest } from './api';
import type { UpcomingAppointmentResponse } from '../types/UpcomingAppointment.types';
export function readUpcomingAppointment(businessId?: string, signal?: AbortSignal) {
  return apiRequest<UpcomingAppointmentResponse>(`/v1/me/bookings/upcoming${businessId ? `?${new URLSearchParams({ businessId })}` : ''}`, { signal });
}

import { apiRequest } from './api';
import type { AppointmentHistory, AppointmentStatus, LifecycleAppointment } from '../types/AppointmentLifecycle.types';
export function readAppointmentHistory(bookingId: string, businessId?: string, signal?: AbortSignal) {
  const prefix = businessId ? `/v1/provider/businesses/${encodeURIComponent(businessId)}/bookings` : '/v1/bookings';
  return apiRequest<AppointmentHistory>(`${prefix}/${encodeURIComponent(bookingId)}/history`, { signal });
}
export function updateAppointmentOutcome(booking: LifecycleAppointment, businessId: string, status: Exclude<AppointmentStatus, 'CONFIRMED'>) {
  return apiRequest(`/v1/provider/businesses/${encodeURIComponent(businessId)}/bookings/${encodeURIComponent(booking.id)}/${status === 'CANCELLED' ? 'cancel' : 'outcome'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: booking.revision, ...(status === 'CANCELLED' ? {} : { status }) }) });
}

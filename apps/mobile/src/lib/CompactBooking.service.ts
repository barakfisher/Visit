import { apiRequest } from './api';
import type { BookingCalendar } from '../types/CompactBooking.types';
export function readBookingCalendar(providerId: string, serviceId: string, fromDate: string, days: number, fromBookingId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ fromDate, days: String(days), ...(fromBookingId ? {} : { serviceId }) });
  return apiRequest<BookingCalendar>(`/api/${fromBookingId ? `bookings/${fromBookingId}` : `providers/${providerId}`}/booking-calendar?${query}`, { ...(signal ? { signal } : {}) });
}

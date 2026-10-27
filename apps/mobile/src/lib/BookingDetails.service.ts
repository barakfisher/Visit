import { apiRequest } from './api';
import type { BookingCalendarExport, BookingDetails } from '../types/BookingDetails.types';
export function readBookingDetails(id: string, signal?: AbortSignal) { return apiRequest<BookingDetails>(`/v1/bookings/${encodeURIComponent(id)}/details`, { signal }); }
export function readBookingCalendar(id: string, revision: number) { return apiRequest<BookingCalendarExport>(`/v1/bookings/${encodeURIComponent(id)}/calendar?${new URLSearchParams({ revision: String(revision) })}`); }
export function cancelDetailedBooking(id: string, revision: number) { return apiRequest(`/v1/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision }) }); }

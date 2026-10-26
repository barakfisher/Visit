import { apiRequest, ApiError } from './api';
import type { BookingAttempt, BookingOutcome } from '../types/BookingAttempt.types';
export function commitBooking(attempt: BookingAttempt) {
  const { identityId: _identityId, ...input } = attempt;
  return apiRequest<BookingOutcome>('/api/bookings/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, finalConsent: true }) });
}
export async function recoverBooking(attempt: BookingAttempt): Promise<BookingOutcome | null> {
  try { return await apiRequest<BookingOutcome>(`/api/bookings/attempts?${new URLSearchParams({ businessId: attempt.providerId, key: attempt.idempotencyKey })}`); }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}

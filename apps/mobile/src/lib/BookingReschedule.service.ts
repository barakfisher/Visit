import { apiRequest } from './api';
import type { BookingOutcome } from '../types/BookingAttempt.types';
import type { RescheduleAttempt } from '../types/BookingReschedule.types';
export function commitReschedule(attempt: RescheduleAttempt) {
  return apiRequest<BookingOutcome>(`/v1/bookings/${encodeURIComponent(attempt.bookingId)}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ finalConsent: true, idempotencyKey: attempt.idempotencyKey, expectedRevision: attempt.expectedRevision, staffId: attempt.staffId, startsAt: attempt.startsAt }) });
}

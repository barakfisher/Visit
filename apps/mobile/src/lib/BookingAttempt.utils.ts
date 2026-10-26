import type { BookingOutcome } from '../types/BookingAttempt.types';
export function canDiscardBookingAttempt(recovered: BookingOutcome | null): boolean {
  return recovered?.status === 'CANCELLED' || recovered?.status === 'EXPIRED';
}

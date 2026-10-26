import type { BookingOutcome } from '../types/BookingAttempt.types';
export function canDiscardBookingAttempt(recovered: BookingOutcome | null): boolean {
  return recovered?.status === 'CANCELLED' || recovered?.status === 'EXPIRED';
}

export function isCommittedBookingOutcome(outcome: BookingOutcome | null): boolean {
  return outcome?.status === 'CONFIRMED' || outcome?.status === 'COMPLETED' || outcome?.status === 'NO_SHOW';
}

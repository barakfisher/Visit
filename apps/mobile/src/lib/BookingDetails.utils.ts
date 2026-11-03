import type { BookingDetails } from '../types/BookingDetails.types';
export function hasConfirmedBooking(booking: BookingDetails | undefined, fresh: boolean) { return fresh && booking?.status === 'CONFIRMED'; }

/** How the customer reached the confirmation screen. A reschedule lands on the same booking ID, so the route says which. */
export type ConfirmationOutcome = 'booked' | 'rescheduled';
export const RESCHEDULED_OUTCOME: ConfirmationOutcome = 'rescheduled';
export function parseConfirmationOutcome(value: unknown): ConfirmationOutcome { return value === RESCHEDULED_OUTCOME ? RESCHEDULED_OUTCOME : 'booked'; }

export function bookingDetailsCopyKeys(mode: 'confirmation' | 'details', confirmed: boolean, outcome: ConfirmationOutcome) {
  const rescheduled = mode === 'confirmation' && outcome === RESCHEDULED_OUTCOME;
  return {
    heading: mode === 'confirmation' && confirmed ? rescheduled ? 'details.rescheduled' as const : 'details.success' as const : 'details.title' as const,
    subtitle: confirmed ? rescheduled ? 'details.rescheduledNote' as const : 'details.confirmed' as const : undefined,
  };
}

/** The cutoff and the confirmation-message notes only describe an appointment that is still scheduled. */
export function showsScheduledNotes(booking: Pick<BookingDetails, 'status'>) { return booking.status === 'CONFIRMED'; }

export function parseBookingDetailsId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

import type { BookingDetails } from '../types/BookingDetails.types';

/** Said once, when the commit returns; never derived from the route, so a reload does not repeat it. */
export function bookingCommitToastKey(rescheduled: boolean) { return rescheduled ? 'details.rescheduledNote' as const : 'details.confirmed' as const; }

/** The cutoff and the confirmation-message notes only describe an appointment that is still scheduled. */
export function showsScheduledNotes(booking: Pick<BookingDetails, 'status'>) { return booking.status === 'CONFIRMED'; }

/** A scheduled appointment needs no status line: its date already says so. An ended one must say how it ended. */
export function showsStatus(booking: Pick<BookingDetails, 'status'>) { return booking.status !== 'CONFIRMED'; }

export function parseBookingDetailsId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

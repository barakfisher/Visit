import type { BookingDetails } from '../types/BookingDetails.types';
export function hasConfirmedBooking(booking: BookingDetails | undefined, fresh: boolean) { return fresh && booking?.status === 'CONFIRMED'; }

export function parseBookingDetailsId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

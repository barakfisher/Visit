import type { BookingAttempt } from './BookingAttempt.types';
export type RescheduleAttempt = BookingAttempt & { bookingId: string; expectedRevision: number };

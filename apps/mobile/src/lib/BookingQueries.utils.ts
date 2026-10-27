export function isBookingQuery(key: readonly unknown[]) {
  return ['me', 'consumer', 'provider', 'booking-details', 'appointment-history', 'availability', 'booking-calendar'].includes(String(key[0]));
}

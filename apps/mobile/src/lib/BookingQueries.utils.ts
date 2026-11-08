export function isBookingQuery(key: readonly unknown[]) {
  return ['me', 'consumer', 'provider', 'booking-details', 'appointment-history', 'availability', 'booking-calendar'].includes(String(key[0]));
}

/** The reads that show a customer their own appointments. The profile also lives under 'me' and is not one of them. */
export function isCustomerAppointmentQuery(key: readonly unknown[]) {
  if (key[0] === 'me') return key[1] === 'upcoming' || key[1] === 'bookings';
  return key[0] === 'consumer' || key[0] === 'booking-details' || key[0] === 'appointment-history';
}

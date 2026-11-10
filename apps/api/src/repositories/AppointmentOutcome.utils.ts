/**
 * An appointment that has ended counts as attended unless the business records a no-show. The stored row stays
 * CONFIRMED until someone records an outcome, so a no-show can still be recorded later; every read that shows a
 * status to a person reads it through `presentedStatus`, so the customer's screens and the business's agenda agree.
 * Anything that counts appointments by status (a report, a summary) must use the same rule, not the stored column.
 */
type StoredAppointment = { status: string; endsAt: Date };

export function presentedStatus<Status extends string>(booking: { status: Status; endsAt: Date }, now: number): Status | 'COMPLETED' {
  return booking.status === 'CONFIRMED' && +booking.endsAt <= now ? 'COMPLETED' : booking.status;
}

/** The business may still record a no-show for an ended appointment that nobody has given an outcome yet. */
export function canMarkNoShow(booking: StoredAppointment, now: number) {
  return booking.status === 'CONFIRMED' && +booking.endsAt <= now;
}

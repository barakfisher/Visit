export function customerBookingActions(booking: { status: string; startsAt: Date; business: { approvalStatus: string; deletedAt: Date | null; bookingPolicy: { cancellationCutoffMinutes: number; rescheduleCutoffMinutes: number } | null } }, now: number) {
  const policy = booking.business.bookingPolicy;
  return {
    canExport: booking.status === 'CONFIRMED',
    canCancel: booking.status === 'CONFIRMED' && Boolean(policy) && +booking.startsAt >= now + (policy?.cancellationCutoffMinutes ?? 0) * 60000,
    canReschedule: booking.status === 'CONFIRMED' && Boolean(policy) && booking.business.approvalStatus === 'APPROVED' && !booking.business.deletedAt && +booking.startsAt >= now + (policy?.rescheduleCutoffMinutes ?? 0) * 60000,
  };
}

import type { AppointmentActionScope, LifecycleAppointment } from '../types/AppointmentLifecycle.types';
export function canRecordAppointmentOutcome(booking: LifecycleAppointment, now = Date.now()) {
  const endsAt = Date.parse(booking.endsAt);
  return booking.status === 'CONFIRMED' && Number.isFinite(endsAt) && Number.isFinite(now) && endsAt <= now;
}
export function canContinueAppointmentAction(initial: AppointmentActionScope, current: AppointmentActionScope, mounted: boolean, businessId?: string) {
  return mounted && initial.identityId !== null && initial.identityId === current.identityId && initial.contextVersion === current.contextVersion && initial.activeBusinessId === current.activeBusinessId && (!businessId || current.activeBusinessId === businessId);
}
export function appointmentOutcomeDelay(endsAt: string, now: number): number | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end) || !Number.isFinite(now) || end <= now) return null;
  return Math.min(end - now + 1, 2147483647);
}

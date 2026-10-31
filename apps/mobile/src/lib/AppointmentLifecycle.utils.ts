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
// API refusal codes for a customer's own appointment inside the business's change window.
export const RESCHEDULE_CUTOFF = 'RESCHEDULE_CUTOFF';
export const CANCELLATION_CUTOFF = 'CANCELLATION_CUTOFF';
// A cutoff refusal gets copy that says why; anything else keeps the caller's own fallback.
export function appointmentRefusalKey(code: string | undefined) {
  return code === CANCELLATION_CUTOFF ? 'lifecycle.cancelCutoff' as const : code === RESCHEDULE_CUTOFF ? 'lifecycle.rescheduleCutoff' as const : null;
}

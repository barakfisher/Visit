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
// A booking screen that cannot load says why in the app's language: a cutoff, a business that is not bookable
// (not found or unpublished answer alike), or a plain load failure. The server's diagnostic is never shown.
export function bookingLoadRefusalKey(code: string | undefined, status: number | undefined) {
  return appointmentRefusalKey(code) ?? (status === 404 ? 'providers.unavailable' as const : 'compact.detailsFailed' as const);
}
// The cancel refusal shown on an Appointments card: a cutoff says why, anything else is the general failure.
export function appointmentCancelFailureKey(code: string | undefined) {
  return appointmentRefusalKey(code) ?? 'lifecycle.failure' as const;
}
// A scheduled appointment whose changes the server no longer accepts says so instead of losing its buttons silently.
export function appointmentLockedKey(actions: { canCancel: boolean; canReschedule: boolean }) {
  if (actions.canCancel && actions.canReschedule) return null;
  return !actions.canCancel && !actions.canReschedule ? 'lifecycle.lockedBoth' as const : !actions.canCancel ? 'lifecycle.lockedCancel' as const : 'lifecycle.lockedReschedule' as const;
}
const MINUTE_MS = 60000;
// A time chosen inside the business's change window can still be booked, but the review says it cannot be undone in the app.
// Uses the device clock as a hint; the server's cutoff stays authoritative.
export function bookingWindowWarningKey(startsAt: string, now: number, policy: { cancellationCutoffMinutes?: number; rescheduleCutoffMinutes?: number } | null | undefined) {
  const start = Date.parse(startsAt);
  if (!policy || !Number.isFinite(start) || !Number.isFinite(now)) return null;
  const inside = (minutes: number | undefined) => minutes !== undefined && start < now + minutes * MINUTE_MS;
  const cancel = inside(policy.cancellationCutoffMinutes), reschedule = inside(policy.rescheduleCutoffMinutes);
  return cancel && reschedule ? 'bookingCommit.insideBoth' as const : cancel ? 'bookingCommit.insideCancel' as const : reschedule ? 'bookingCommit.insideReschedule' as const : null;
}

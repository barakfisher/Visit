import type { ActiveBooking } from './flows';
export type AppointmentStatus = 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
export type LifecycleAppointment = { id: string; status: AppointmentStatus; revision: number; startsAt: string; endsAt: string };
export type HistoricalAppointment = LifecycleAppointment & ActiveBooking & { service: ActiveBooking['service'] & { durationMinutes: number; priceMinor: number | null; currency: string | null } };
export type AppointmentEvent = { id: string; revision: number; kind: 'BASELINE' | 'CREATED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'; source: 'MANUAL' | 'CUSTOMER' | 'PROVIDER' | 'SYSTEM'; reason: 'MANUAL_ENTRY' | 'MANUAL_CONTACT_EXCEPTION' | 'LEGACY_BASELINE' | 'FINAL_CONSENT' | 'CUSTOMER_REQUEST' | 'PROVIDER_REQUEST' | 'APPOINTMENT_FINISHED' | 'CUSTOMER_ABSENT' | 'SYSTEM_CHANGE'; oldStatus: AppointmentStatus | null; newStatus: AppointmentStatus; oldStartsAt: string | null; newStartsAt: string; createdAt: string };
export type AppointmentHistory = { id: string; status: AppointmentStatus; revision: number; events: AppointmentEvent[] };
export type LifecycleView = { status: string; toggleLabel: string; expanded: boolean; loading: boolean; loadingLabel: string; error: string; busy: boolean; events: { id: string; action: string; recorded: string; detail: string; source: string }[]; empty: string; retryLabel: string; completeLabel: string; noShowLabel: string; cancelLabel: string; onToggle: () => void; onRetry: () => void; onComplete?: () => void; onNoShow?: () => void; onCancel?: () => void };
export type AppointmentActionScope = { identityId: string | null; contextVersion: number; activeBusinessId: string | null };

export type AppointmentAuditProps = { booking: LifecycleAppointment; timezone: string; businessId?: string };

import type { HistoricalAppointment } from './AppointmentLifecycle.types';
export type UpcomingAppointment = HistoricalAppointment & { actions: { canCancel: boolean; canReschedule: boolean } };
export type UpcomingAppointmentResponse = { booking: UpcomingAppointment | null; additionalCount: number };
export type UpcomingAppointmentView = {
  state: 'hidden' | 'loading' | 'error' | 'ready'; heading: string; loadingLabel: string; error: string; retryLabel: string;
  appointment: { id: string; service: string; business: string; staff: string; when: string; timeNote: string; canCancel: boolean; canReschedule: boolean } | null;
  additionalLabel: string; detailsLabel: string; cancelLabel: string; rescheduleLabel: string; busy: boolean;
  onRetry: () => void; onDetails: () => void; onAll: () => void; onCancel: () => void; onReschedule: () => void;
};

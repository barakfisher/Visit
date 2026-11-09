import type { HistoricalAppointment } from './AppointmentLifecycle.types';
export type UpcomingAppointment = HistoricalAppointment & { business: { location: string | null }; actions: { canCancel: boolean; canReschedule: boolean } };
export type UpcomingAppointmentResponse = { booking: UpcomingAppointment | null; additionalCount: number; today: UpcomingAppointment[] };
export type UpcomingAppointmentView = {
  state: 'hidden' | 'loading' | 'error' | 'ready';
  /** Empty on Home, where the cards speak for themselves; a booking page says whose appointment this is. */
  heading: string; loadingLabel: string; error: string; retryLabel: string;
  appointments: { id: string; when: string; place: string }[];
  onRetry: () => void; onOpen: (id: string) => void;
};

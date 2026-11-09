import type { HistoricalAppointment } from './AppointmentLifecycle.types';
export type UpcomingAppointment = HistoricalAppointment & { business: { location: string | null }; actions: { canCancel: boolean; canReschedule: boolean } };
export type UpcomingAppointmentResponse = { booking: UpcomingAppointment | null; additionalCount: number; today: UpcomingAppointment[] };
export type UpcomingAppointmentView = {
  state: 'hidden' | 'loading' | 'error' | 'ready';
  /** What the cards show. On Home it is a section title, level with "My providers". */
  heading: string; sectionHeading?: boolean; loadingLabel: string; error: string; retryLabel: string;
  appointments: { id: string; when: string; place: string }[];
  onRetry: () => void; onOpen: (id: string) => void;
};

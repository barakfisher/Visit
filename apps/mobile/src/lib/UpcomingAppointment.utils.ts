import type { UpcomingAppointment, UpcomingAppointmentResponse } from '../types/UpcomingAppointment.types';

export function upcomingStartDelay(startsAt: string, now: number): number | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  return Math.max(1, Math.min(start - now + 1, 2147483647));
}

/** Home lists today's appointments and falls back to the next one; a business's page shows only the next one there. */
export function visibleAppointments({ booking, today }: Pick<UpcomingAppointmentResponse, 'booking' | 'today'>, now: number, nextOnly: boolean): UpcomingAppointment[] {
  const candidates = nextOnly || !today.length ? booking ? [booking] : [] : today;
  return candidates.filter(item => item.status === 'CONFIRMED' && Date.parse(item.startsAt) >= now);
}

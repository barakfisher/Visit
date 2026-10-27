import { localDate } from './appointmentTime';
import type { ProviderDetail } from '../types/flows';
import type { CalendarDay } from '@/components/HorizontalCalendarBar';
export const todayInTimezone = localDate;
export function makeCalendarDays(provider: ProviderDetail, count = 30): CalendarDay[] {
  const start = todayInTimezone(provider.timezone);
  return Array.from({ length: Math.min(count, (provider.bookingPolicy?.maximumAdvanceDays ?? 30) + 1) }, (_, index) => {
    const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
    const id = date.toISOString().slice(0, 10);
    const override = provider.scheduleOverrides.find((item) => item.date.slice(0, 10) === id);
    const open = override ? override.isOpen : provider.weeklyAvailability.some((hours) => hours.weekday === date.getUTCDay());
    return { id, label: new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(date), dateLabel: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date), accessibilityLabel: `${id}${open ? '' : ' (closed)'}`, disabled: !open };
  });
}

import type { ProviderDetail } from '../types/flows';
import type { CalendarDay } from '@/components/HorizontalCalendarBar';
export function todayInTimezone(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
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

type CalendarBooking = { id: string; startsAt: string; endsAt: string; business: { name: string; timezone: string }; service: { name: string }; staff: { displayName: string } };
const escapeCalendarText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const calendarStamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export async function exportBookingCalendar(booking: CalendarBooking) {
  const { Platform } = await import('react-native');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Visit//Appointments//EN', 'CALSCALE:GREGORIAN', `X-WR-TIMEZONE:${escapeCalendarText(booking.business.timezone)}`, 'BEGIN:VEVENT', `UID:${booking.id}@visit.app`, `DTSTAMP:${calendarStamp(new Date().toISOString())}`, `DTSTART:${calendarStamp(booking.startsAt)}`, `DTEND:${calendarStamp(booking.endsAt)}`, `SUMMARY:${escapeCalendarText(`${booking.service.name} at ${booking.business.name}`)}`, `DESCRIPTION:${escapeCalendarText(`With ${booking.staff.displayName}`)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const filename = `visit-${booking.id}.ics`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device.');
    const file = new File(Paths.cache, filename); file.create({ overwrite: true }); file.write(body);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'public.calendar-event' });
  }
}

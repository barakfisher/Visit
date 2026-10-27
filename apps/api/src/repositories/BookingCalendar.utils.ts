import type { CalendarAppointment } from './BookingCalendar.types.js';
const encoder = new TextEncoder();
export function escapeCalendarText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
export function foldCalendarLine(line: string) {
  const result: string[] = []; let current = '', bytes = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (bytes + width > 75) { result.push(current); current = ' '; bytes = 1; }
    current += character; bytes += width;
  }
  result.push(current); return result.join('\r\n');
}
function stamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(+date) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new RangeError('Invalid calendar instant.');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
export function bookingCalendarBody(booking: CalendarAppointment) {
  if (!booking.id || !Number.isSafeInteger(booking.revision) || booking.revision < 0 || !(Date.parse(booking.startsAt) < Date.parse(booking.endsAt))) throw new RangeError('Invalid appointment calendar data.');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Visit//Appointments//EN', 'CALSCALE:GREGORIAN', `X-WR-TIMEZONE:${escapeCalendarText(booking.business.timezone)}`, 'BEGIN:VEVENT', `UID:${encodeURIComponent(booking.id)}@visit.app`, `DTSTAMP:${stamp(booking.updatedAt)}`, `LAST-MODIFIED:${stamp(booking.updatedAt)}`, `SEQUENCE:${booking.revision}`, `DTSTART:${stamp(booking.startsAt)}`, `DTEND:${stamp(booking.endsAt)}`, 'STATUS:CONFIRMED', `SUMMARY:${escapeCalendarText(`${booking.service.name} at ${booking.business.name}`)}`, `DESCRIPTION:${escapeCalendarText(`With ${booking.staff.displayName}`)}`, 'END:VEVENT', 'END:VCALENDAR', ''].map(foldCalendarLine).join('\r\n');
}

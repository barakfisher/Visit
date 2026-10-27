import type { BookingCalendarExport } from '../types/BookingDetails.types';
export async function shareBookingCalendar(payload: BookingCalendarExport, isCurrent: () => boolean) {
  const { Platform } = await import('react-native');
  if (!isCurrent()) return;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([payload.body], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    try { anchor.href = url; anchor.download = payload.filename; document.body.appendChild(anchor); anchor.click(); }
    finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  } else {
    const { File, Paths } = await import('expo-file-system'), Sharing = await import('expo-sharing'), { randomUUID } = await import('expo-crypto');
    if (!isCurrent()) return;
    if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device.');
    if (!isCurrent()) return;
    const file = new File(Paths.cache, `visit-${randomUUID()}.ics`);
    try { file.create(); file.write(payload.body); await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'public.calendar-event', dialogTitle: payload.filename }); }
    finally { if (file.exists) file.delete(); }
  }
}

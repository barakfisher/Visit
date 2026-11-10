import { appointmentDate, appointmentTime } from '@/src/lib/appointmentTime';
import { AppText as Text } from './AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { View } from 'react-native';
import { ActiveBookingCard } from './ActiveBookingCard';
import { appointmentLockedKey } from '@/src/lib/AppointmentLifecycle.utils';
import type { ActiveBooking } from '../src/types/flows';

// A booking that carries server actions offers only the changes the server will accept, and says when one is no longer possible.
type ListedBooking = ActiveBooking & { actions?: { canCancel: boolean; canReschedule: boolean } };
// Cards stack at every width: a phone shows each one whole, and only the first is the next visit.
export function ActiveBookings<T extends ListedBooking>({ bookings, onOpen, onReschedule, onCancel, busyBookingId, error }: { busyBookingId?: string | null; bookings: T[]; onOpen?: (booking: T) => void; onReschedule?: (booking: T) => void; onCancel?: (booking: T) => void; error?: { bookingId: string; message: string } | null }) {
  const { t, locale } = useAppLocale();
  const lockedNote = (booking: T) => { const key = booking.actions ? appointmentLockedKey(booking.actions) : null; return key ? t(key) : ''; };
  if (!bookings.length) return <View className="rounded-card border border-line bg-surface p-4"><Text className="text-sm text-muted">{t('ui.noBookings')}</Text></View>;
  return <View className="gap-3">{bookings.map((booking, index) => <View key={booking.id} testID={`active-booking-${booking.id}`}><ActiveBookingCard label={index === 0 ? t('ui.nextVisit') : ''} busy={busyBookingId === booking.id} service={booking.service.name} provider={`${booking.staff.displayName} · ${booking.business.name}`} dateLabel={appointmentDate(booking.startsAt, booking.business.timezone, locale)} timeLabel={appointmentTime(booking.startsAt, booking.business.timezone, locale)} onOpen={onOpen ? () => onOpen(booking) : undefined} onReschedule={onReschedule && booking.actions?.canReschedule !== false ? () => onReschedule(booking) : undefined} onCancel={onCancel && booking.actions?.canCancel !== false ? () => onCancel(booking) : undefined} note={lockedNote(booking)} error={error?.bookingId === booking.id ? error.message : ''} /></View>)}</View>;
}

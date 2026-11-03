import { appointmentDate, appointmentTime } from '@/src/lib/appointmentTime';
import { AppText as Text } from './AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ScrollView, View } from 'react-native';
import { ActiveBookingCard } from './ActiveBookingCard';
import { appointmentLockedKey } from '@/src/lib/AppointmentLifecycle.utils';
import type { ActiveBooking } from '../src/types/flows';

// A booking that carries server actions offers only the changes the server will accept, and says when one is no longer possible.
type ListedBooking = ActiveBooking & { actions?: { canCancel: boolean; canReschedule: boolean } };
export function ActiveBookings({ bookings, onReschedule, onCancel, busyBookingId, error }: { busyBookingId?: string | null; bookings: ListedBooking[]; onReschedule?: (booking: ActiveBooking) => void; onCancel?: (booking: ActiveBooking) => void; error?: { bookingId: string; message: string } | null }) {
  const { t, locale } = useAppLocale();
  const lockedNote = (booking: ListedBooking) => { const key = booking.actions ? appointmentLockedKey(booking.actions) : null; return key ? t(key) : ''; };
  if (!bookings.length) return <View className="rounded-card border border-line bg-surface p-4"><Text className="text-sm text-muted">{t('ui.noBookings')}</Text></View>;
  return <ScrollView horizontal={bookings.length > 1} showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3"><View className="flex-row gap-3">{bookings.map((booking) => <View key={booking.id} testID={`active-booking-${booking.id}`} style={bookings.length > 1 ? { width: 310 } : { flex: 1 }}><ActiveBookingCard busy={busyBookingId === booking.id} service={booking.service.name} provider={`${booking.staff.displayName} · ${booking.business.name}`} dateLabel={appointmentDate(booking.startsAt, booking.business.timezone, locale)} timeLabel={appointmentTime(booking.startsAt, booking.business.timezone, locale)} timezone={booking.business.timezone} onReschedule={onReschedule && booking.actions?.canReschedule !== false ? () => onReschedule(booking) : undefined} onCancel={onCancel && booking.actions?.canCancel !== false ? () => onCancel(booking) : undefined} note={lockedNote(booking)} error={error?.bookingId === booking.id ? error.message : ''} /></View>)}</View></ScrollView>;
}

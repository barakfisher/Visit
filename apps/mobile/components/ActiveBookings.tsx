import { appointmentDate, appointmentTime } from '@/src/lib/appointmentTime';
import { AppText as Text } from './AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ScrollView, View } from 'react-native';
import { ActiveBookingCard } from './ActiveBookingCard';
import type { ActiveBooking } from '../src/types/flows';
export function ActiveBookings({ bookings, onReschedule, onCancel, busyBookingId }: { busyBookingId?: string | null; bookings: ActiveBooking[]; onReschedule?: (booking: ActiveBooking) => void; onCancel?: (booking: ActiveBooking) => void }) {
  const { t, locale } = useAppLocale();
  if (!bookings.length) return <View className="rounded-card border border-line bg-surface p-4"><Text className="text-sm text-muted">{t('ui.noBookings')}</Text></View>;
  return <ScrollView horizontal={bookings.length > 1} showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3"><View className="flex-row gap-3">{bookings.map((booking) => <View key={booking.id} testID={`active-booking-${booking.id}`} style={bookings.length > 1 ? { width: 310 } : { flex: 1 }}><ActiveBookingCard busy={busyBookingId === booking.id} service={booking.service.name} provider={`${booking.staff.displayName} · ${booking.business.name}`} dateLabel={appointmentDate(booking.startsAt, booking.business.timezone, locale)} timeLabel={appointmentTime(booking.startsAt, booking.business.timezone, locale)} timezone={booking.business.timezone} onReschedule={onReschedule ? () => onReschedule(booking) : undefined} onCancel={onCancel ? () => onCancel(booking) : undefined} /></View>)}</View></ScrollView>;
}

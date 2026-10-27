import { Link } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { ActiveBookings } from './ActiveBookings';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { ScreenContent } from './ScreenContent';
import { AppointmentAudit } from './AppointmentAudit.component';
import { appointmentDate, appointmentTime, timePolicyNote } from '@/src/lib/appointmentTime';
import { formatMoney } from '@/src/types/flows';
import type { useAppointments } from '@/src/lib/Appointments.hook';
export function Appointments(view: ReturnType<typeof useAppointments>) {
  const { t, locale, identity, error, busyBookingId, bookings, history, cancel, reschedule } = view;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-8"><ScreenContent className="gap-5">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{t('appointments.title')}</AppText>
    {!identity ? <Link href="/auth/login" className="min-h-touch py-3 font-semibold text-brand">{t('common.signIn')}</Link> : <>
      {bookings.isLoading ? <AppText>{t('common.loading')}</AppText> : bookings.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void bookings.refetch()} /> : <ActiveBookings busyBookingId={busyBookingId} bookings={bookings.data?.bookings ?? []} onCancel={booking => void cancel(booking)} onReschedule={reschedule} />}
      <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t('lifecycle.history')}</AppText>
      {history.isLoading ? <AppText accessibilityRole="status">{t('common.loading')}</AppText> : history.isError ? <View className="gap-2"><AppText accessibilityRole="alert">{t('lifecycle.loadFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void history.refetch()} /></View> : !history.data?.bookings.length ? <AppText>{t('lifecycle.empty')}</AppText> : history.data.bookings.map(booking => <View key={booking.id} testID={`history-booking-${booking.id}`} className="gap-3 rounded-card border border-line bg-surface p-5">
        <AppText className="text-lg font-semibold text-ink">{booking.service.name}</AppText><AppText>{booking.business.name} · {booking.staff.displayName}</AppText><AppText>{appointmentDate(booking.startsAt, booking.business.timezone, locale)} · {appointmentTime(booking.startsAt, booking.business.timezone, locale)}</AppText><AppText>{booking.service.durationMinutes} {t('bookingCommit.minutes')} · {formatMoney(booking.service.priceMinor, booking.service.currency)}</AppText><AppText className="text-sm text-muted">{timePolicyNote(booking.business.timezone, locale)}</AppText>
        <Link href={{ pathname: '/appointment/[bookingId]', params: { bookingId: booking.id } }} className="min-h-touch py-3 font-semibold text-brand">{t('details.open')}</Link>
        <AppointmentAudit key={`${identity}:${booking.id}`} booking={booking} timezone={booking.business.timezone} />
      </View>)}
    </>}
    {error ? <AppText accessibilityRole="alert" className="text-danger">{error}</AppText> : null}
    <Link href="/" className="min-h-touch py-3 font-semibold text-brand">{t('nav.home')}</Link>
  </ScreenContent></ScrollView>;
}

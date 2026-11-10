import { Link } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { ActiveBookings } from './ActiveBookings';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { ScreenContent } from './ScreenContent';
import { Control } from './Control';
import type { useAppointments } from '@/src/lib/Appointments.hook';
export function Appointments(view: ReturnType<typeof useAppointments>) {
  const { t, identity, error, busyBookingId, bookings, upcoming, cancel, reschedule, filter, openHistory, open } = view;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-4"><ScreenContent className="gap-5">
    {/* No screen title: the footer tab already names the screen, and the first card's "next visit" opens it. */}
    {filter ? <View testID="appointments-filter" className="flex-row flex-wrap items-center justify-between gap-x-3 rounded-control bg-brand-soft px-4 py-1">
      <AppText className="font-semibold text-ink">{filter.name ? t('appointments.filtered', { name: filter.name }) : t('appointments.filteredUnnamed')}</AppText>
      <Control accessibilityRole="button" onPress={filter.onClear} className="justify-center"><AppText className="font-semibold text-brand">{t('appointments.showAll')}</AppText></Control>
    </View> : null}
    {!identity ? <Link href="/auth/login" className="min-h-touch py-3 font-semibold text-brand">{t('common.signIn')}</Link> : <>
      {bookings.isLoading ? <AppText>{t('common.loading')}</AppText> : bookings.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void bookings.refetch()} /> : <View className="gap-3">{error && !bookings.data?.bookings.some(booking => booking.id === error.bookingId) ? <AppText accessibilityRole="alert" className="rounded-control bg-red-50 p-3 text-danger">{error.message}</AppText> : null}<ActiveBookings busyBookingId={busyBookingId} bookings={upcoming ?? []} error={error} onOpen={open} onCancel={booking => void cancel(booking)} onReschedule={reschedule} /></View>}
      <Control testID="appointments-history-link" accessibilityRole="link" onPress={openHistory} className="justify-center self-start"><AppText className="font-semibold text-brand">{t('appointments.showHistory')}</AppText></Control>
    </>}
  </ScreenContent></ScrollView>;
}

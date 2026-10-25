import { appointmentDate, appointmentTime } from '@/src/lib/appointmentTime';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { apiRequest, ApiError } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import { ActiveBookingCard } from '@/components/ActiveBookingCard';
import { confirmAppointmentCancellation } from '@/src/lib/bookingActions';

export default function HomeScreen() {
  const { locale, t } = useAppLocale();
  const identityId = useSessionStore((state) => state.identityId);
  const queryClient = useQueryClient();
  const bookings = useQuery({ queryKey: ['me', 'bookings'], queryFn: () => apiRequest<{ bookings: { id: string; status: string; startsAt: string; business: { id: string; name: string; timezone: string }; service: { id: string; name: string }; staff: { displayName: string } }[] }>('/v1/me/bookings'), enabled: Boolean(identityId) });
  const upcoming = bookings.data?.bookings.filter((booking) => booking.status === 'CONFIRMED' && new Date(booking.startsAt).getTime() >= bookings.dataUpdatedAt).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const [bookingError, setBookingError] = useState('');

  async function cancel(bookingId: string) {
    if (!await confirmAppointmentCancellation()) return;
    setBookingError('');
    try { await apiRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' }); await queryClient.invalidateQueries({ queryKey: ['me', 'bookings'] }); }
    catch (reason) { setBookingError(reason instanceof ApiError ? reason.message : 'Could not cancel this appointment.'); }
  }
  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-6 px-5 py-8 md:px-8">
      <View className="gap-2">
        <Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text>
        <Text accessibilityRole="header" className="text-4xl font-bold tracking-tight text-ink">Your time, well spent.</Text>
        <Text className="text-base leading-6 text-body">Find a service and book a time that works for you.</Text>
      </View>
      {bookings.isLoading && identityId ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">Loading your next appointment…</Text></View> : null}
      {upcoming ? <View testID={`active-booking-${upcoming.id}`}><ActiveBookingCard service={upcoming.service.name} provider={`${upcoming.staff.displayName} · ${upcoming.business.name}`} dateLabel={appointmentDate(upcoming.startsAt, upcoming.business.timezone, locale)} timeLabel={appointmentTime(upcoming.startsAt, upcoming.business.timezone, locale)} timezone={upcoming.business.timezone} onReschedule={() => router.push({ pathname: '/booking/[providerId]', params: { providerId: upcoming.business.id, serviceId: upcoming.service.id, fromBookingId: upcoming.id } })} onCancel={() => void cancel(upcoming.id)} /></View> : null}
      {identityId ? <Link href="/appointments" className="min-h-touch py-3 font-semibold text-brand">{t('appointments.all')}</Link> : null}
      {bookingError ? <Text accessibilityRole="alert" className="text-warning">{bookingError}</Text> : null}
      {!identityId ? <Link href="/auth/login" className="self-start rounded-control border border-line bg-surface px-5 py-4 font-semibold text-brand">Sign in</Link> : null}
    </ScrollView>
  );
}

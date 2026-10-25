import { useState } from 'react';
import { Link, router } from 'expo-router';
import { ScrollView } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActiveBookings } from '@/components/ActiveBookings';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { ScreenContent } from '@/components/ScreenContent';
import { useAuthStore } from '@/src/state/auth';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import { confirmAppointmentCancellation } from '@/src/lib/bookingActions';
import type { ActiveBooking } from '@/src/types/flows';
export default function Appointments() {
  const { t } = useAppLocale();
  const identity = useAuthStore(s => s.identityId), client = useQueryClient();
  const [error, setError] = useState('');
  const bookings = useQuery({ queryKey: ['consumer', 'active', identity], queryFn: () => apiRequest<{ bookings: ActiveBooking[] }>('/api/consumer/bookings/active'), enabled: !!identity });
  async function cancel(booking: ActiveBooking) {
    if (!await confirmAppointmentCancellation()) return;
    setError('');
    try { await apiRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/cancel`, { method: 'POST' }); await client.invalidateQueries({ predicate: q => ['consumer', 'me'].includes(String(q.queryKey[0])) }); }
    catch { setError(t('account.failure')); }
  }
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-8"><ScreenContent className="gap-5">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{t('appointments.title')}</AppText>
    {!identity ? <Link href="/auth/login" className="min-h-touch py-3 font-semibold text-brand">{t('common.signIn')}</Link> : bookings.isLoading ? <AppText>{t('common.loading')}</AppText> : bookings.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void bookings.refetch()} /> : <ActiveBookings bookings={bookings.data?.bookings ?? []} onCancel={booking => void cancel(booking)} onReschedule={booking => router.push({ pathname: '/booking/[providerId]', params: { providerId: booking.business.id, serviceId: booking.service.id, fromBookingId: booking.id } })} />}
    {error ? <AppText accessibilityRole="alert" className="text-danger">{error}</AppText> : null}
    <Link href="/" className="min-h-touch py-3 font-semibold text-brand">{t('nav.home')}</Link>
  </ScreenContent></ScrollView>;
}

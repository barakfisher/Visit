import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../state/auth';
import { useAppLocale } from '../i18n/LocaleContext';
import { apiRequest } from './api';
import { historyEntries } from './AppointmentHistory';
import { useActiveAppointments } from './ActiveAppointments.hook';
import { appointmentsAt } from './ProviderHome';
import { useProviderDetail } from './ProviderDetail.service';
import type { HistoricalAppointment } from '../types/AppointmentLifecycle.types';
export function useAppointments() {
  const { t, locale } = useAppLocale();
  const contextVersion = useAuthStore(state => state.contextVersion);
  // A business page opens this list narrowed to its own appointments; the URL keeps that across a reload.
  const params = useLocalSearchParams<{ businessId?: string }>();
  const businessId = typeof params.businessId === 'string' && params.businessId ? params.businessId : undefined;
  const { identity, error, busyBookingId, bookings, cancel, reschedule } = useActiveAppointments();
  // Past appointments are rarely what the customer came for, so they load only when asked for.
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ['me', 'bookings', identity, contextVersion], queryFn: () => apiRequest<{ bookings: HistoricalAppointment[] }>('/v1/me/bookings'), enabled: Boolean(identity) && showHistory });
  const historyList = history.data ? historyEntries(history.data.bookings, { status: bookings.status, ids: bookings.data?.bookings.map(booking => booking.id) ?? [] }) : null;
  const provider = useProviderDetail(businessId ?? '', Boolean(businessId));
  const upcoming = bookings.data ? appointmentsAt(bookings.data.bookings, businessId) : undefined;
  const businessName = businessId ? provider.data?.provider.name ?? upcoming?.[0]?.business.name ?? history.data?.bookings.find(booking => booking.business.id === businessId)?.business.name ?? '' : '';
  return { t, locale, identity, error, busyBookingId, bookings, upcoming, history, historyList: historyList ? appointmentsAt(historyList, businessId) : null, cancel, reschedule, showHistory, toggleHistory: () => setShowHistory(value => !value),
    open: (booking: { id: string }) => router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: booking.id } }),
    filter: businessId ? { name: businessName, onClear: () => router.setParams({ businessId: undefined }) } : null };
}

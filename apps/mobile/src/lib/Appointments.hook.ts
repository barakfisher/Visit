import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../state/auth';
import { useAppLocale } from '../i18n/LocaleContext';
import { apiRequest } from './api';
import { confirmAppointmentCancellation } from './bookingActions';
import type { HistoricalAppointment } from '../types/AppointmentLifecycle.types';
import type { ActiveBooking } from '../types/flows';
export function useAppointments() {
  const { t, locale } = useAppLocale(), client = useQueryClient();
  const identity = useAuthStore(state => state.identityId), contextVersion = useAuthStore(state => state.contextVersion);
  const [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const bookings = useQuery({ queryKey: ['consumer', 'active', identity, contextVersion], queryFn: () => apiRequest<{ bookings: HistoricalAppointment[] }>('/api/consumer/bookings/active'), enabled: Boolean(identity) });
  const history = useQuery({ queryKey: ['me', 'bookings', identity, contextVersion], queryFn: () => apiRequest<{ bookings: HistoricalAppointment[] }>('/v1/me/bookings'), enabled: Boolean(identity) });
  async function cancel(booking: ActiveBooking) {
    if (pending.current) return;
    const current = bookings.data?.bookings.find(item => item.id === booking.id);
    if (!current) return;
    const scope = { identityId: identity, contextVersion, activeBusinessId: useAuthStore.getState().activeBusinessId };
    pending.current = true;
    try {
      if (!await confirmAppointmentCancellation()) return;
      if (!canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current)) return;
      setError('');
      await apiRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision }) });
      if (!canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current)) return;
      await client.invalidateQueries({ predicate: query => ['consumer', 'me', 'appointment-history'].includes(String(query.queryKey[0])) });
    } catch { if (canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current)) { setError(t('lifecycle.failure')); await bookings.refetch(); } }
    finally { pending.current = false; }
  }
  function reschedule(booking: ActiveBooking) { router.push({ pathname: '/booking/[providerId]', params: { providerId: booking.business.id, serviceId: booking.service.id, fromBookingId: booking.id } }); }
  return { t, locale, identity, error, bookings, history, cancel, reschedule };
}

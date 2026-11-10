import { isBookingQuery } from './BookingQueries.utils';
import { appointmentCancelFailureKey, canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../state/auth';
import { useAppLocale } from '../i18n/LocaleContext';
import { ApiError, apiRequest } from './api';
import { confirmAppointmentCancellation } from './bookingActions';
import type { ActiveAppointment } from '../types/AppointmentLifecycle.types';
import type { ActiveBooking } from '../types/flows';

/** The customer's confirmed appointments ahead, with the cancel and reschedule both My appointments and a business page offer. */
export function useActiveAppointments() {
  const { t } = useAppLocale(), client = useQueryClient();
  const identity = useAuthStore(state => state.identityId), contextVersion = useAuthStore(state => state.contextVersion);
  // A failed cancel belongs to the card it came from, so it shows next to that card's button.
  const [error, setError] = useState<{ bookingId: string; message: string } | null>(null);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const bookings = useQuery({ queryKey: ['consumer', 'active', identity, contextVersion], queryFn: () => apiRequest<{ bookings: ActiveAppointment[] }>('/api/consumer/bookings/active'), enabled: Boolean(identity) });
  async function cancel(booking: ActiveBooking) {
    if (pending.current) return;
    const current = bookings.data?.bookings.find(item => item.id === booking.id);
    if (!current?.actions.canCancel) return;
    const scope = { identityId: identity, contextVersion, activeBusinessId: useAuthStore.getState().activeBusinessId };
    pending.current = true; setBusyBookingId(booking.id);
    try {
      if (!await confirmAppointmentCancellation()) return;
      if (!canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current)) return;
      setError(null);
      await apiRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision }) });
      if (!canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current)) return;
      await client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) });
    } catch (reason) { if (canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current)) { setError({ bookingId: booking.id, message: t(appointmentCancelFailureKey(reason instanceof ApiError ? reason.code : undefined)) }); await bookings.refetch(); } }
    finally { pending.current = false; if (mounted.current) setBusyBookingId(null); }
  }
  function reschedule(booking: ActiveBooking) {
    if (!bookings.data?.bookings.find(item => item.id === booking.id)?.actions.canReschedule) return;
    router.push({ pathname: '/booking/[providerId]', params: { providerId: booking.business.id, serviceId: booking.service.id, fromBookingId: booking.id } });
  }
  return { identity, error, busyBookingId, bookings, cancel, reschedule };
}

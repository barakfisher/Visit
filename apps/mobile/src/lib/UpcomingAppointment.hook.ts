import { upcomingStartDelay } from './UpcomingAppointment.utils';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useSessionStore } from '../state/session';
import { useAppLocale } from '../i18n/LocaleContext';
import { readUpcomingAppointment } from './UpcomingAppointment.service';
import { cancelDetailedBooking } from './BookingDetails.service';
import { confirmAppointmentCancellation } from './bookingActions';
import { appointmentRefusalKey, canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { ApiError } from './api';
import { appointmentDate, appointmentTime, timePolicyNote } from './appointmentTime';
import { isBookingQuery } from './BookingQueries.utils';
import type { UpcomingAppointmentView } from '../types/UpcomingAppointment.types';
export function useUpcomingAppointment(businessId?: string, enabled = true): UpcomingAppointmentView {
  const { t, locale } = useAppLocale(), router = useRouter(), client = useQueryClient();
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const focused = useIsFocused(), focusedRef = useRef(focused), mounted = useRef(true), operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ scope: string; id: string; message: string } | null>(null);
  const scopeKey = JSON.stringify([identity, version, businessId, enabled]);
  const scopeRef = useRef(scopeKey);
  useEffect(() => { scopeRef.current = scopeKey; }, [scopeKey]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { focusedRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useQuery({ queryKey: ['me', 'upcoming', identity, version, businessId ?? 'all'], queryFn: ({ signal }) => readUpcomingAppointment(businessId, signal), enabled: Boolean(identity && enabled && focused), staleTime: 0, refetchOnMount: 'always', refetchInterval: 60000 });
  const { refetch } = query;
  const candidate = query.data?.booking;
  useEffect(() => {
    if (!candidate || !focused || !enabled) return;
    const delay = upcomingStartDelay(candidate.startsAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => { setNow(Date.now()); void refetch(); }, delay);
    return () => clearTimeout(timer);
  }, [candidate, focused, enabled, refetch]);
  const booking = candidate && candidate.status === 'CONFIRMED' && Date.parse(candidate.startsAt) >= now ? candidate : null;
  const ready = Boolean(identity && focused && enabled && query.isSuccess && !query.isFetching && booking);
  function capture() {
    const scope = { identityId: identity, contextVersion: version, activeBusinessId: useSessionStore.getState().activeBusinessId };
    return () => scopeRef.current === scopeKey && focusedRef.current && canContinueAppointmentAction(scope, useSessionStore.getState(), mounted.current);
  }
  async function cancel() {
    if (!ready || !booking?.actions.canCancel || operation.current) return;
    operation.current = true; setBusy(true); setFailure(null); const isCurrent = capture();
    try {
      if (!await confirmAppointmentCancellation({ title: t('upcoming.cancelTitle'), message: t('upcoming.cancelMessage'), keep: t('upcoming.keep'), cancel: t('details.cancel') }) || !isCurrent()) return;
      await cancelDetailedBooking(booking.id, booking.revision);
      if (isCurrent()) await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
    } catch (reason) {
      if (isCurrent()) { setFailure({ scope: scopeKey, id: booking.id, message: t(appointmentRefusalKey(reason instanceof ApiError ? reason.code : undefined) ?? 'upcoming.failure') }); await query.refetch(); }
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  return { state: !identity || !enabled || !focused ? 'hidden' : query.isPending || query.isFetching ? 'loading' : query.isError ? 'error' : booking ? 'ready' : 'hidden',
    heading: t(businessId ? 'upcoming.context' : 'upcoming.heading'), loadingLabel: t('home.loadingBooking'), error: query.isError ? t('home.bookingFailure') : failure?.scope === scopeKey && failure.id === booking?.id ? failure.message : '', retryLabel: t('home.retryBooking'),
    appointment: ready && booking ? { id: booking.id, service: booking.service.name, business: booking.business.name, staff: booking.staff.displayName, when: `${appointmentDate(booking.startsAt, booking.business.timezone, locale)} · ${appointmentTime(booking.startsAt, booking.business.timezone, locale)}`, timeNote: timePolicyNote(booking.business.timezone, locale), canCancel: booking.actions.canCancel, canReschedule: booking.actions.canReschedule } : null,
    additionalLabel: query.data?.additionalCount ? t('upcoming.more', { count: query.data.additionalCount }) : '', detailsLabel: t('details.open'), cancelLabel: t('details.cancel'), rescheduleLabel: t('details.reschedule'), busy,
    onRetry: () => { setFailure(null); if (identity && enabled && focused) void query.refetch(); }, onAll: () => router.push('/appointments'),
    onDetails: () => { if (ready && booking && !operation.current) router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: booking.id } }); },
    onReschedule: () => { if (ready && booking?.actions.canReschedule && !operation.current) router.push({ pathname: '/booking/[providerId]', params: { providerId: booking.business.id, serviceId: booking.service.id, fromBookingId: booking.id } }); }, onCancel: () => void cancel(),
  };
}

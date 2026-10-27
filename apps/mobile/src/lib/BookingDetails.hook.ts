import { useEffect, useRef, useState } from 'react';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppLocale } from '../i18n/LocaleContext';
import { useAuthStore } from '../state/auth';
import { ApiError } from './api';
import { readBookingDetails, readBookingCalendar, cancelDetailedBooking } from './BookingDetails.service';
import { shareBookingCalendar } from './BookingCalendar.service';
import { hasConfirmedBooking, parseBookingDetailsId } from './BookingDetails.utils';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { confirmAppointmentCancellation } from './bookingActions';
import { appointmentDate, appointmentTime, timePolicyNote } from './appointmentTime';
import { formatMoney } from '../types/flows';
import type { BookingDetailsView } from '../types/BookingDetails.types';
export function useBookingDetails(mode: 'confirmation' | 'details'): BookingDetailsView {
  const { t, locale } = useAppLocale(), client = useQueryClient(), router = useRouter();
  const params = useLocalSearchParams<{ bookingId: string }>(), id = parseBookingDetailsId(params.bookingId) ?? '';
  const identity = useAuthStore(state => state.identityId), contextVersion = useAuthStore(state => state.contextVersion), bootstrap = useAuthStore(state => state.bootstrapStatus);
  const focused = useIsFocused(), focusedRef = useRef(focused), mounted = useRef(true), currentId = useRef(id), operation = useRef(false);
  const [exporting, setExporting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [exportError, setExportError] = useState('');
  useEffect(() => { focusedRef.current = focused; currentId.current = id; }, [focused, id]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const details = useQuery({ queryKey: ['booking-details', identity, contextVersion, id], queryFn: ({ signal }) => readBookingDetails(id, signal), enabled: Boolean(identity && id), refetchOnMount: 'always', staleTime: 0 });
  const fresh = details.isSuccess && !details.isFetching, booking = fresh ? details.data : undefined, confirmed = hasConfirmedBooking(booking, fresh);
  function capture() {
    const scope = { identityId: identity, contextVersion, activeBusinessId: useAuthStore.getState().activeBusinessId };
    return () => currentId.current === id && focusedRef.current && canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current);
  }
  async function exportCalendar() {
    if (!booking?.actions.canExport || operation.current) return;
    operation.current = true; setExporting(true); setExportError(''); const isCurrent = capture();
    try { const payload = await readBookingCalendar(booking.id, booking.revision); if (isCurrent()) await shareBookingCalendar(payload, isCurrent); }
    catch { if (isCurrent()) { setExportError(t('details.exportFailure')); await details.refetch(); } }
    finally { operation.current = false; if (mounted.current) setExporting(false); }
  }
  async function cancel() {
    if (!booking?.actions.canCancel || operation.current) return;
    operation.current = true; setBusy(true); setError(''); const isCurrent = capture();
    try {
      if (!await confirmAppointmentCancellation() || !isCurrent()) return;
      await cancelDetailedBooking(booking.id, booking.revision);
      if (isCurrent()) await Promise.allSettled([details.refetch(), client.invalidateQueries({ predicate: query => ['me', 'consumer', 'appointment-history'].includes(String(query.queryKey[0])) })]);
    } catch { if (isCurrent()) { setError(t('lifecycle.failure')); await details.refetch(); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  const failure = !id ? t('details.unavailable') : bootstrap === 'error' ? t('details.failure') : details.isError ? details.error instanceof ApiError && [401, 404].includes(details.error.status) ? t('details.unavailable') : t('details.failure') : '';
  return { heading: mode === 'confirmation' && confirmed ? t('details.success') : t('details.title'), subtitle: confirmed ? t('details.confirmed') : '', loading: bootstrap === 'loading' || Boolean(identity && id && details.isPending) || details.isFetching, loadingLabel: t('details.loading'), needsSignIn: bootstrap === 'ready' && !identity, signInLabel: t('details.signIn'), onSignIn: () => router.push({ pathname: '/auth/login', params: { returnTo: `/${mode === 'confirmation' ? 'confirmation' : 'appointment'}/${encodeURIComponent(id)}` } }), onReschedule: () => { if (booking?.actions.canReschedule) router.push({ pathname: '/booking/[providerId]', params: { providerId: booking.business.id, serviceId: booking.service.id, fromBookingId: booking.id } }); }, onDetails: () => { if (booking) router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: booking.id } }); }, onHistory: () => router.push('/appointments'), onHome: () => router.push('/'), error: error || failure, retryLabel: t('common.retry'), onRetry: () => { setError(''); if (bootstrap === 'error') useAuthStore.getState().retryBootstrap(); else if (id && identity) void details.refetch(); }, booking,
    when: booking ? `${appointmentDate(booking.startsAt, booking.business.timezone, locale)} · ${appointmentTime(booking.startsAt, booking.business.timezone, locale)}` : '', timeNote: booking ? timePolicyNote(booking.business.timezone, locale) : '', status: booking ? t(`lifecycle.${booking.status}`) : '', durationAndPrice: booking ? `${booking.service.durationMinutes} ${t('bookingCommit.minutes')} · ${formatMoney(booking.service.priceMinor, booking.service.currency)}` : '', cancellation: booking ? t('bookingCommit.cancel', { minutes: booking.cancellationCutoffMinutes }) : '', notificationNote: booking ? t(booking.notification.status === 'RECORDED' ? 'details.recorded' : 'details.legacy') : '', unsupportedSms: t('details.sms'), unsupportedWhatsapp: t('details.whatsapp'), exporting, busy, exportLabel: t('details.export'), exportError, onExport: () => void exportCalendar(), onCancel: () => void cancel(), cancelLabel: t('details.cancel'), rescheduleLabel: t('details.reschedule'), homeLabel: t('details.home'), historyLabel: t('details.history'), detailsLabel: t('details.open'), detailsMode: mode === 'details' };
}

import { isBookingQuery } from './BookingQueries.utils';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppLocale } from '../i18n/LocaleContext';
import { formatAppointment } from '../i18n/messages';
import { useAuthStore } from '../state/auth';
import { readAppointmentHistory, updateAppointmentOutcome } from './AppointmentLifecycle.service';
import { appointmentOutcomeDelay, canContinueAppointmentAction, canMarkNoShow } from './AppointmentLifecycle.utils';
import { confirmAppointmentCancellation } from './bookingActions';
import type { AppointmentStatus, LifecycleAppointment, LifecycleView } from '../types/AppointmentLifecycle.types';
/** `open`, when given, is the caller's: a card that opens its own changes. Otherwise the history's own toggle decides. */
// An ended appointment nobody recorded reads as completed, yet the business may still cancel it (a day it was closed) as well as mark a no-show.
export function useAppointmentLifecycle(booking: LifecycleAppointment, timezone: string, businessId?: string, open?: boolean): LifecycleView {
  const { t, locale } = useAppLocale(), client = useQueryClient();
  const identityId = useAuthStore(state => state.identityId), contextVersion = useAuthStore(state => state.contextVersion);
  const [toggled, setExpanded] = useState(false), expanded = open ?? toggled, [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const delay = appointmentOutcomeDelay(booking.endsAt, now);
    if (delay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [booking.endsAt, now]);
  const operation = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const history = useQuery({ queryKey: ['appointment-history', identityId, contextVersion, businessId ?? 'customer', booking.id, booking.revision], queryFn: ({ signal }) => readAppointmentHistory(booking.id, businessId, signal), enabled: Boolean(expanded && identityId) });
  async function change(status: Exclude<AppointmentStatus, 'CONFIRMED'>) {
    if (!businessId || operation.current) return;
    const scope = { identityId, contextVersion, activeBusinessId: useAuthStore.getState().activeBusinessId };
    operation.current = true; setBusy(true); setError('');
    try {
      if (status === 'CANCELLED' && !await confirmAppointmentCancellation()) return;
      if (!canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current, businessId)) return;
      await updateAppointmentOutcome(booking, businessId, status);
      if (!canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current, businessId)) return;
      await client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) });
    } catch { if (canContinueAppointmentAction(scope, useAuthStore.getState(), mounted.current, businessId)) { setError(t('lifecycle.failure')); await client.invalidateQueries({ queryKey: ['provider', businessId, 'agenda'] }); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  const events = history.data?.events.map(event => ({ id: event.id, action: t(`lifecycle.event.${event.kind}`), recorded: formatAppointment(locale, event.createdAt, timezone), detail: `${event.oldStartsAt && event.oldStartsAt !== event.newStartsAt ? `${formatAppointment(locale, event.oldStartsAt, timezone)} → ` : ''}${formatAppointment(locale, event.newStartsAt, timezone)}`, source: `${t(`lifecycle.source.${event.source}`)} · ${t(`lifecycle.reason.${event.reason}`)}` })) ?? [];
  return { status: t(`lifecycle.${booking.status}`), toggleLabel: t(expanded ? 'lifecycle.hide' : 'lifecycle.show'), expanded, loading: history.isLoading, loadingLabel: t('common.loading'), error: error || (history.isError ? t('lifecycle.loadFailed') : ''), busy, events, empty: t('lifecycle.empty'), retryLabel: t('common.retry'), noShowLabel: t('lifecycle.noShow'), cancelLabel: t('lifecycle.cancel'), onToggle: () => setExpanded(value => !value), onRetry: () => void history.refetch(),
    ...(businessId && canMarkNoShow(booking, now) ? { onNoShow: () => void change('NO_SHOW') } : {}), ...(businessId && (booking.status === 'CONFIRMED' || canMarkNoShow(booking, now)) ? { onCancel: () => void change('CANCELLED') } : {}),
  };
}

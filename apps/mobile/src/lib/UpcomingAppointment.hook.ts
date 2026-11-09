import { upcomingCardState, upcomingStartDelay, visibleAppointments } from './UpcomingAppointment.utils';
import { businessListingLine } from './BusinessListing';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useSessionStore } from '../state/session';
import { useAppLocale } from '../i18n/LocaleContext';
import { readUpcomingAppointment } from './UpcomingAppointment.service';
import { appointmentDay, appointmentTime } from './appointmentTime';
import type { UpcomingAppointmentView } from '../types/UpcomingAppointment.types';
export function useUpcomingAppointment(businessId?: string, enabled = true): UpcomingAppointmentView {
  const { t, locale } = useAppLocale(), router = useRouter();
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const focused = useIsFocused();
  const [now, setNow] = useState(Date.now);
  const query = useQuery({ queryKey: ['me', 'upcoming', identity, version, businessId ?? 'all'], queryFn: ({ signal }) => readUpcomingAppointment(businessId, signal), enabled: Boolean(identity && enabled && focused), staleTime: 0, refetchOnMount: 'always' });
  const { refetch } = query;
  const candidate = query.data?.booking;
  useEffect(() => {
    if (!candidate || !focused || !enabled) return;
    const delay = upcomingStartDelay(candidate.startsAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => { setNow(Date.now()); void refetch(); }, delay);
    return () => clearTimeout(timer);
  }, [candidate, focused, enabled, refetch]);
  const appointments = query.data ? visibleAppointments(query.data, now, Boolean(businessId)) : [];
  // A background re-read keeps the cards on screen; only a first read has nothing to show yet.
  const active = Boolean(identity && focused && enabled);
  return { state: upcomingCardState({ visible: active, isPending: query.isPending, isError: query.isError, isFetching: query.isFetching, hasBooking: appointments.length > 0 }),
    heading: t(businessId ? 'upcoming.context' : 'upcoming.next'), sectionHeading: !businessId, loadingLabel: t('home.loadingBooking'), error: query.isError ? t('home.bookingFailure') : '', retryLabel: t('home.retryBooking'),
    appointments: active && query.isSuccess ? appointments.map(booking => ({ id: booking.id, when: `${appointmentDay(booking.startsAt, booking.business.timezone, locale)} · ${appointmentTime(booking.startsAt, booking.business.timezone, locale)}`, place: [booking.business.name, businessListingLine(booking.business.location, null)].filter(Boolean).join(' · ') })) : [],
    onRetry: () => { if (active) void query.refetch(); },
    onOpen: id => { if (active) router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: id } }); },
  };
}

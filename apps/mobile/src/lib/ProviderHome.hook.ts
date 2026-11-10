import { useState } from 'react';
import { Linking } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { translateCount } from '../i18n/plural';
import { ApiError } from './api';
import { useActiveAppointments } from './ActiveAppointments.hook';
import { appointmentLockedKey } from './AppointmentLifecycle.utils';
import { appointmentDay, appointmentTime } from './appointmentTime';
import { businessListingLine } from './BusinessListing';
import { appointmentsAt, providerContacts, providerWeek } from './ProviderHome';
import { useProviderDetail } from './ProviderDetail.service';
import { formatIntervals, groupWeek, isClosedWeek } from './WeeklyHours';
import { ltr } from './TimeBlocks';
import { formatMoney } from '../types/flows';
import type { ProviderHomePanel, ProviderHomeView } from '../types/ProviderHome.types';

/** A customer's page for one business: the next appointment there and what they can do with the business. */
export function useProviderHome(): ProviderHomeView {
  const { t, locale } = useAppLocale();
  const params = useLocalSearchParams<{ businessId: string }>();
  const businessId = typeof params.businessId === 'string' ? params.businessId : '';
  const detail = useProviderDetail(businessId);
  const active = useActiveAppointments();
  const [panel, setPanel] = useState<ProviderHomePanel | null>(null);
  const provider = detail.data?.provider;
  const here = active.bookings.data ? appointmentsAt(active.bookings.data.bookings, businessId) : [];
  const first = here[0];
  const contacts = provider ? providerContacts(provider) : null;
  const week = providerWeek(provider?.weeklyAvailability ?? []);
  const lockedKey = first ? appointmentLockedKey(first.actions) : null;
  return {
    t,
    // Without an id the read never starts and would stay pending; there is no business to show.
    state: !businessId ? 'unavailable' : detail.isPending ? 'loading' : detail.error instanceof ApiError && detail.error.status === 404 ? 'unavailable' : detail.isError ? 'error' : 'ready',
    onRetry: () => { void detail.refetch(); },
    name: provider?.name ?? '', listing: businessListingLine(provider?.location, provider?.category),
    appointmentsState: !active.identity ? 'hidden' : active.bookings.isPending ? 'loading' : active.bookings.isError ? 'error' : 'ready',
    onRetryAppointments: () => { void active.bookings.refetch(); },
    next: first ? {
      id: first.id, when: `${appointmentDay(first.startsAt, first.business.timezone, locale)} · ${appointmentTime(first.startsAt, first.business.timezone, locale)}`,
      what: `${first.service.name} · ${first.staff.displayName}`, note: lockedKey ? t(lockedKey) : '',
      error: active.error?.bookingId === first.id ? active.error.message : '', busy: active.busyBookingId === first.id,
      onOpen: () => router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: first.id } }),
      onReschedule: first.actions.canReschedule ? () => active.reschedule(first) : undefined,
      onCancel: first.actions.canCancel ? () => void active.cancel(first) : undefined,
    } : null,
    mineSummary: here.length ? translateCount(locale, 'providerHome.mineCount', here.length) : t('providerHome.mineNone'),
    onBook: () => router.push({ pathname: '/booking/[providerId]', params: { providerId: businessId } }),
    onMine: () => router.push({ pathname: '/appointments', params: { businessId } }),
    contacts,
    contactSummary: contacts ? [contacts.phone && t('providerHome.phone'), contacts.email && t('providerHome.email'), contacts.location && t('providerHome.address')].filter(Boolean).join(', ') : '',
    onCall: () => { if (contacts?.phone) void Linking.openURL(`tel:${contacts.phone}`); },
    onWrite: () => { if (contacts?.email) void Linking.openURL(`mailto:${encodeURIComponent(contacts.email)}`); },
    description: provider?.description?.trim() ?? '',
    services: provider?.services.map(service => ({ id: service.id, name: service.name, summary: `${service.durationMinutes} ${t('bookingCommit.minutes')} · ${formatMoney(service.priceMinor, service.currency)}` })) ?? [],
    hours: isClosedWeek(week) ? [] : groupWeek(week).map(group => ({ days: group.days.map(day => t(`hours.day.${day}`)).join(', '), hours: group.intervals.length ? ltr(formatIntervals(group.intervals)) : t('hours.closed') })),
    panel, onPanel: next => setPanel(current => current === next ? null : next),
  };
}

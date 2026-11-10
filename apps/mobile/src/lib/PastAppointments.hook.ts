import { useInfiniteQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { appointmentDate, appointmentTime } from './appointmentTime';
import { readPastAppointments } from './PastAppointments.service';
import { useProviderDetail } from './ProviderDetail.service';
import { formatMoney } from '../types/flows';
import type { PastAppointmentsView } from '../types/PastAppointments.types';

/** Past appointments a page at a time; the screen asks for the next page as the customer nears the end of the list. */
export function usePastAppointments(): PastAppointmentsView {
  const { t, locale } = useAppLocale();
  const identity = useSessionStore(state => state.identityId), bootstrap = useSessionStore(state => state.bootstrapStatus), contextVersion = useSessionStore(state => state.contextVersion);
  // Opened from a business's filtered list, the history stays narrowed to it; the URL keeps that across a reload.
  const params = useLocalSearchParams<{ businessId?: string }>();
  const businessId = typeof params.businessId === 'string' && params.businessId ? params.businessId : undefined;
  const pages = useInfiniteQuery({
    queryKey: ['me', 'bookings', 'history', identity, contextVersion, businessId ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => readPastAppointments(pageParam, businessId, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: Boolean(identity),
  });
  const provider = useProviderDetail(businessId ?? '', Boolean(businessId));
  const bookings = pages.data?.pages.flatMap(page => page.bookings) ?? [];
  const more = () => { if (pages.hasNextPage && !pages.isFetchingNextPage && !pages.isFetchNextPageError) void pages.fetchNextPage(); };
  return {
    t, locale, bootstrapping: !identity && bootstrap !== 'ready', signedOut: !identity && bootstrap === 'ready',
    state: pages.isPending ? 'loading' : pages.isError && !pages.data ? 'error' : 'ready',
    appointments: bookings.map(booking => ({
      id: booking.id, booking, service: booking.service.name, place: t('ui.provider', { provider: `${booking.staff.displayName} · ${booking.business.name}` }),
      when: t('ui.when', { date: appointmentDate(booking.startsAt, booking.business.timezone, locale), time: appointmentTime(booking.startsAt, booking.business.timezone, locale) }),
      details: `${booking.service.durationMinutes} ${t('bookingCommit.minutes')} · ${formatMoney(booking.service.priceMinor, booking.service.currency)}`,
      status: t(`lifecycle.${booking.status}`),
    })),
    hasMore: Boolean(pages.hasNextPage), loadingMore: pages.isFetchingNextPage, moreFailed: pages.isFetchNextPageError,
    filter: businessId ? { name: provider.data?.provider.name ?? bookings[0]?.business.name ?? '', onClear: () => router.setParams({ businessId: undefined }) } : null,
    onMore: more,
    // A failed next page keeps the pages already shown and asks for the same page again.
    onRetry: () => { if (pages.isFetchNextPageError) void pages.fetchNextPage(); else void pages.refetch(); },
    onOpen: id => router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: id } }),
    onBack: () => { if (router.canGoBack()) router.back(); else router.replace(businessId ? { pathname: '/appointments', params: { businessId } } : '/appointments'); },
  };
}

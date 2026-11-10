import { router, useLocalSearchParams } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useActiveAppointments } from './ActiveAppointments.hook';
import { appointmentsAt } from './ProviderHome';
import { useProviderDetail } from './ProviderDetail.service';
export function useAppointments() {
  const { t, locale } = useAppLocale();
  // A business page opens this list narrowed to its own appointments; the URL keeps that across a reload.
  const params = useLocalSearchParams<{ businessId?: string }>();
  const businessId = typeof params.businessId === 'string' && params.businessId ? params.businessId : undefined;
  const { identity, error, busyBookingId, bookings, cancel, reschedule } = useActiveAppointments();
  const provider = useProviderDetail(businessId ?? '', Boolean(businessId));
  const upcoming = bookings.data ? appointmentsAt(bookings.data.bookings, businessId) : undefined;
  const businessName = businessId ? provider.data?.provider.name ?? upcoming?.[0]?.business.name ?? '' : '';
  return { t, locale, identity, error, busyBookingId, bookings, upcoming, cancel, reschedule,
    // Past appointments have their own screen, paged; a business's filter goes with the customer.
    openHistory: () => router.push(businessId ? { pathname: '/appointments/history', params: { businessId } } : '/appointments/history'),
    open: (booking: { id: string }) => router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: booking.id } }),
    filter: businessId ? { name: businessName, onClear: () => router.setParams({ businessId: undefined }) } : null };
}

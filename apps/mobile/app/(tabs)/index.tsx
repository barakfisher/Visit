import { appointmentDate, appointmentTime } from '@/src/lib/appointmentTime';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { apiRequest } from '@/src/lib/api';
import { useSessionStore } from '@/src/state/session';
import { ActiveBookingCard } from '@/components/ActiveBookingCard';
import { SavedProviderCard, type SavedProviderItem } from '@/components/SavedProviderCard';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { SessionLoading } from '@/components/SessionLoading';
type Page = { providers: SavedProviderItem[]; nextCursor: string | null };
type Booking = { id: string; status: string; startsAt: string; business: { id: string; name: string; timezone: string }; service: { id: string; name: string }; staff: { displayName: string } };
export default function HomeScreen() {
  const { locale, t } = useAppLocale();
  const identity = useSessionStore(s => s.identityId), bootstrap = useSessionStore(s => s.bootstrapStatus);
  const client = useQueryClient();
  const bookings = useQuery({ queryKey: ['me', 'bookings', identity], queryFn: () => apiRequest<{ bookings: Booking[] }>('/v1/me/bookings'), enabled: !!identity, refetchInterval: 60000 });
  const upcoming = bookings.data?.bookings.filter(b => b.status === 'CONFIRMED' && new Date(b.startsAt).getTime() >= bookings.dataUpdatedAt).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const saved = useInfiniteQuery({ queryKey: ['my-providers', identity], initialPageParam: null as string | null, queryFn: ({ pageParam }) => apiRequest<Page>(`/api/me/providers${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !!identity });
  const remove = useMutation({ mutationFn: async ({ businessId, identity }: { businessId: string; identity: string; version: number }) => apiRequest(`/api/me/providers/${encodeURIComponent(businessId)}`, { method: 'DELETE', headers: { 'X-Visit-Expected-Identity': identity } }), onSuccess: (_result, input) => {
    const current = useSessionStore.getState(); if (current.identityId !== input.identity || current.contextVersion !== input.version) return;
    client.removeQueries({ queryKey: ['my-provider-saved', input.identity, input.businessId], exact: true }); void client.invalidateQueries({ queryKey: ['my-providers', input.identity] });
  } });
  if (!identity && bootstrap !== 'ready') return <SessionLoading />;
  return <ScrollView testID="home-screen" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-6 md:px-8">
    <View className="gap-2"><AppText accessibilityRole="header" className="text-3xl font-bold tracking-tight text-ink">{t('home.title')}</AppText><AppText className="text-base leading-6 text-body">{t('home.intro')}</AppText></View>
    {!identity ? <Link href="/auth/login" className="min-h-action rounded-control bg-brand px-5 py-4 text-center font-semibold text-white">{t('common.signIn')}</Link> : <>
      {bookings.isLoading ? <AppText>{t('home.loadingBooking')}</AppText> : null}
      {bookings.isError ? <View className="gap-3"><AppText accessibilityRole="alert">{t('home.bookingFailure')}</AppText><ActionButton secondary label={t('home.retryBooking')} onPress={() => void bookings.refetch()} /></View> : null}
      {upcoming ? <View testID={`active-booking-${upcoming.id}`}><ActiveBookingCard actionsPending service={upcoming.service.name} provider={`${upcoming.staff.displayName} · ${upcoming.business.name}`} dateLabel={appointmentDate(upcoming.startsAt, upcoming.business.timezone, locale)} timeLabel={appointmentTime(upcoming.startsAt, upcoming.business.timezone, locale)} timezone={upcoming.business.timezone} /></View> : null}
      <Link href="/appointments" className="min-h-touch py-3 font-semibold text-brand">{t('appointments.all')}</Link>
      <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t('home.providers')}</AppText>
      {saved.isPending ? <AppText>{t('home.loadingProviders')}</AppText> : saved.isError ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText accessibilityRole="alert">{t('home.providersFailure')}</AppText><ActionButton secondary label={t('home.retryProviders')} onPress={() => void saved.refetch()} /></View> : <>
        {!saved.data?.pages.some(p => p.providers.length) ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText className="font-semibold text-ink">{t('home.empty')}</AppText><AppText className="leading-6 text-body">{t('home.emptyHelp')}</AppText></View> : saved.data.pages.flatMap(p => p.providers).map(item => <SavedProviderCard key={item.id} item={item} removing={remove.isPending && remove.variables?.businessId === item.businessId} onBook={() => router.push({ pathname: '/booking/[providerId]', params: { providerId: item.businessId } })} onRemove={() => { if (!remove.isPending) remove.mutate({ businessId: item.businessId, identity, version: useSessionStore.getState().contextVersion }); }} />)}
        {saved.hasNextPage ? <ActionButton secondary label={t('home.more')} busy={saved.isFetchingNextPage} onPress={() => void saved.fetchNextPage()} /> : null}
      </>}
      {remove.isError ? <AppText accessibilityRole="alert" className="text-danger">{t('home.removeFailure')}</AppText> : null}
    </>}
  </ScrollView>;
}

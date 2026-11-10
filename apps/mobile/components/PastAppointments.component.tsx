import type { ReactNode } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { BackButton } from './BackButton.component';
import { CardLink } from './CardLink.component';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';
import { SessionLoading } from './SessionLoading';
import type { PastAppointmentItem, PastAppointmentsView } from '@/src/types/PastAppointments.types';

/** How close to the end of the list, in screen heights, the next page is asked for: early enough that scrolling rarely waits. */
const NEXT_PAGE_DISTANCE = 0.75;

/**
 * Past appointments, newest first, a page at a time as the customer scrolls. Each card opens the appointment's details.
 * `audit` is the change history per card, built by the route because Storybook cannot bundle its data hook.
 */
export function PastAppointments({ audit, ...view }: PastAppointmentsView & { audit?: (item: PastAppointmentItem) => ReactNode }) {
  const { t } = view;
  if (view.bootstrapping) return <SessionLoading />;
  const header = <View className="gap-4 pb-1">
    <BackButton label={t('details.back')} onPress={view.onBack} />
    <AppText accessibilityRole="header" className="text-2xl font-bold text-ink">{t('lifecycle.history')}</AppText>
    {view.filter ? <View testID="past-appointments-filter" className="flex-row flex-wrap items-center justify-between gap-x-3 rounded-control bg-brand-soft px-4 py-1">
      <AppText className="font-semibold text-ink">{view.filter.name ? t('appointments.filtered', { name: view.filter.name }) : t('appointments.filteredUnnamed')}</AppText>
      <Control accessibilityRole="button" onPress={view.filter.onClear} className="justify-center"><AppText className="font-semibold text-brand">{t('appointments.showAll')}</AppText></Control>
    </View> : null}
  </View>;
  const empty = view.state === 'loading' ? <AppText role="status">{t('common.loading')}</AppText>
    : view.state === 'error' ? <View className="gap-3 rounded-card border border-line bg-surface p-4"><AppText accessibilityRole="alert">{t('pastAppointments.loadFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={view.onRetry} /></View>
    : <View className="rounded-card border border-line bg-surface p-4"><AppText className="text-muted">{t('lifecycle.empty')}</AppText></View>;
  // The end of the list says what is happening there: the next page arriving, a page that failed, or nothing more.
  const footer = view.loadingMore ? <View className="items-center py-3"><ActivityIndicator accessibilityLabel={t('pastAppointments.loadingMore')} color={tokens.color.brand} /></View>
    : view.moreFailed ? <View className="gap-3 py-2"><AppText accessibilityRole="alert">{t('pastAppointments.moreFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={view.onRetry} /></View>
    : undefined;
  return <FlatList testID="past-appointments" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-3 px-5 py-4 md:px-8"
    data={view.state === 'ready' ? view.appointments : []} keyExtractor={item => item.id}
    renderItem={({ item }) => <PastAppointmentCard item={item} onOpen={() => view.onOpen(item.id)} audit={audit?.(item)} />}
    ListHeaderComponent={header} ListEmptyComponent={empty} ListFooterComponent={footer}
    onEndReached={view.hasMore ? view.onMore : undefined} onEndReachedThreshold={NEXT_PAGE_DISTANCE} />;
}

function PastAppointmentCard({ item, onOpen, audit }: { item: PastAppointmentItem; onOpen: () => void; audit?: ReactNode }) {
  return <CardLink testID={`history-booking-${item.id}`} label={[item.service, item.status, item.place, item.when].join(', ')} onPress={onOpen} contentClassName="gap-3 p-4">
    <CardLink.Passive hidden className="gap-1">
      <View className="flex-row items-center justify-between gap-3">
        <AppText className="shrink text-lg font-semibold text-ink">{item.service}</AppText>
        <DirectionalChevron pointing="forward" color={tokens.color.muted} />
      </View>
      <AppText className="text-sm font-semibold text-brand">{item.status}</AppText>
      <AppText className="text-sm text-body">{item.place}</AppText>
      <AppText className="text-sm text-body">{item.when}</AppText>
      <AppText className="text-sm text-body">{item.details}</AppText>
    </CardLink.Passive>
    {audit}
  </CardLink>;
}

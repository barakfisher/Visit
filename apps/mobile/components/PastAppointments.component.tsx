import { useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { BackButton } from './BackButton.component';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';
import { SessionLoading } from './SessionLoading';
import type { PastAppointmentItem, PastAppointmentsView } from '@/src/types/PastAppointments.types';

/** How close to the end of the list, in screen heights, the next page is asked for: early enough that scrolling rarely waits. */
const NEXT_PAGE_DISTANCE = 0.75;

/**
 * Past appointments, newest first, a page at a time as the customer scrolls. A tap on a card opens its changes in place:
 * the details screen has nothing more to offer an appointment that is over.
 * `audit` is the change history per card, built by the route because Storybook cannot bundle its data hook.
 */
export function PastAppointments({ audit, ...view }: PastAppointmentsView & { audit?: (item: PastAppointmentItem, open: boolean) => ReactNode }) {
  const { t } = view;
  if (view.bootstrapping) return <SessionLoading />;
  const header = <View className="gap-4 pb-1">
    <BackButton label={t('details.back')} onPress={view.onBack} />
    <AppText accessibilityRole="header" className="text-2xl font-bold text-ink">{t('lifecycle.history')}</AppText>
    {view.filter ? <AppText testID="past-appointments-filter" className="-mt-3 text-base text-body">{view.filter.name ? t('pastAppointments.onlyAt', { name: view.filter.name }) : t('pastAppointments.onlyOne')}</AppText> : null}
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
    renderItem={({ item }) => <PastAppointmentCard item={item} changesLabel={t('pastAppointments.changes')} audit={audit} />}
    ListHeaderComponent={header} ListEmptyComponent={empty} ListFooterComponent={footer}
    onEndReached={view.hasMore ? view.onMore : undefined} onEndReachedThreshold={NEXT_PAGE_DISTANCE} />;
}

function PastAppointmentCard({ item, changesLabel, audit }: { item: PastAppointmentItem; changesLabel: string; audit?: (item: PastAppointmentItem, open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View testID={`history-booking-${item.id}`} className="overflow-hidden rounded-card border border-line bg-surface">
    <Control accessibilityRole="button" aria-expanded={open} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(value => !value)} className="gap-3 p-4 active:bg-brand-soft">
      <View className="gap-1">
        <AppText className="text-lg font-semibold text-ink">{item.service}</AppText>
        <AppText className="text-sm font-semibold text-brand">{item.status}</AppText>
        <AppText className="text-sm text-body">{item.place}</AppText>
        <AppText className="text-sm text-body">{item.when}</AppText>
        <AppText className="text-sm text-body">{item.details}</AppText>
      </View>
      <View className="flex-row items-center gap-1.5">
        <AppText className="text-sm font-semibold text-brand">{changesLabel}</AppText>
        <DirectionalChevron pointing={open ? 'up' : 'down'} />
      </View>
    </Control>
    {open && audit ? <View className="px-4 pb-4">{audit(item, open)}</View> : null}
  </View>;
}

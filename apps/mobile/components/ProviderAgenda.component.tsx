import { useState, type ReactNode } from 'react';
import { router, Link } from 'expo-router';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { tokens } from '@/src/design/tokens';
import { itemArrives, itemLeaves } from '@/src/design/motion';
import { AgendaAppointmentCard } from './AgendaAppointmentCard.component';
import { AppointmentAudit } from './AppointmentAudit.component';
import { AppText as Text } from './AppText';
import { BusinessSwitcher } from './BusinessSwitcher.component';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';
import { ShareIcon } from './NavigationIcons.component';
import { AddButton } from './AddButton';
import { TimeBlockRow } from './TimeBlocks';
import { TimeBlockDialog } from './TimeBlockForm.component';
import { formatMoney } from '../src/types/flows';
import type { AgendaAppointment, ProviderAgendaView } from '../src/types/ProviderAgenda.types';
/**
 * The business home: today only, appointments still to come first, and those that ended today folded under one row
 * (decisions.md, "The business home shows today" — 2026-11-10). `published` comes from publication readiness.
 */
export function ProviderAgenda({ published, ...view }: ProviderAgendaView & { published: boolean }) {
  const { business, profile, t, day, agenda, busy, feedback, upcoming, ended } = view;
  const { blockDialog, blockRemoval } = view, { removeFailure: _shownAsFeedback, ...removal } = blockRemoval;
  const [endedOpen, setEndedOpen] = useState(false);
  const revenue = agenda.data ? Object.entries(agenda.data.summary.revenue).map(([currency, amount]) => formatMoney(amount, currency)).join(' · ') || '—' : '—';
  const card = (booking: AgendaAppointment): ReactNode => <AgendaAppointmentCard key={booking.id} booking={booking} span={view.span(booking.startsAt, booking.endsAt)} t={t} contact={view.contact}
    lifecycle={<AppointmentAudit key={`${business.id}:${booking.id}`} booking={booking} timezone={business.timezone} businessId={business.id} quiet />} />;
  return <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-4 px-5 py-5 pb-10" className="flex-1 bg-canvas">
    <Text accessibilityRole="header" className="text-3xl font-bold text-ink">{business.name}</Text>
    <BusinessSwitcher businesses={profile?.businesses ?? []} activeId={business.id} onSelect={view.selectBusiness} />
    <View className="flex-row flex-wrap gap-2">
      {/* Publishing lives in business settings; the agenda only points there (decisions.md, 2026-11-02). */}
      {published ? <ActionButton secondary testID="dashboard-share" label={t('dashboard.share')} icon={color => <ShareIcon color={color} />} onPress={() => router.push({ pathname: '/provider/[businessId]/share', params: { businessId: business.id } })} /> : null}
      {/* The same dialog as the hours screen, starting today (decisions.md, "Time blocks with a reason"). */}
      <AddButton testID="agenda-block" label={t('dashboard.block')} disabled={busy || !agenda.data} onPress={() => blockDialog.openDialog(day)} />
    </View>
    {published ? null : <View testID="dashboard-unpublished" className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-amber-300 bg-amber-50 px-4 py-3"><Text className="flex-1 text-sm text-warning">{t('dashboard.unpublished')}</Text><Link href={{ pathname: '/provider/[businessId]/[section]', params: { businessId: business.id, section: 'publish' } }} className="min-h-touch py-2 font-semibold text-warning underline">{t('dashboard.publishLink')}</Link></View>}
    <TimeBlockDialog staff={agenda.data?.staff ?? []} {...blockDialog} />
    {/* The whole day's totals, including appointments that already ended. */}
    <View testID="agenda-summary" className="flex-row items-center rounded-card bg-brand px-4 py-3">
      <View className="flex-1 gap-0.5"><Text className="text-xs text-teal-50">{t('dashboard.appointments')}</Text><Text className="text-lg font-bold text-white">{agenda.data?.summary.appointments ?? '—'}</Text></View>
      <View className="mx-3 h-8 w-px bg-teal-50 opacity-40" />
      <View className="flex-1 gap-0.5"><Text className="text-xs text-teal-50">{t('dashboard.revenue')}</Text><Text className="text-lg font-bold text-white">{revenue}</Text></View>
    </View>
    {view.notice ? <Text testID="agenda-notice" accessibilityLiveRegion="polite" className="rounded-control bg-brand-soft p-3 text-brand">{view.notice}</Text> : null}
    {feedback ? <Text accessibilityRole="alert" className="text-danger">{feedback}</Text> : null}
    {agenda.isError ? <View className="gap-2"><Text accessibilityRole="alert">{t('agendaEdit.loadFailure')}</Text><ActionButton secondary label={t('common.retry')} onPress={view.retry} /></View>
      : agenda.isLoading || !agenda.data ? <Text role="status" className="text-body">{t('dashboard.loading')}</Text> : <>
        {upcoming.length ? <View className="gap-2">{upcoming.map(card)}</View> : <Text className="text-body">{t(ended.length ? 'dashboard.noneLeft' : 'dashboard.empty')}</Text>}
        {/* Ended appointments stay reachable, since "Mark no-show" exists only once an appointment is over (decisions.md, 2026-11-10). */}
        {ended.length ? <View className="gap-2">
          <Control testID="agenda-ended-toggle" accessibilityRole="button" aria-expanded={endedOpen} accessibilityState={{ expanded: endedOpen }} onPress={() => setEndedOpen(value => !value)} className="flex-row items-center justify-between gap-3 rounded-control px-1">
            <Text className="font-semibold text-muted">{t('dashboard.ended', { count: ended.length })}</Text>
            <DirectionalChevron pointing={endedOpen ? 'up' : 'down'} color={tokens.color.muted} />
          </Control>
          {/* A fade, not SmoothReveal: a card unfolding inside another measured clip would be cut off at its folded height. */}
          {endedOpen ? <Animated.View testID="agenda-ended" entering={itemArrives} exiting={itemLeaves} style={{ gap: 8 }}>{ended.map(card)}</Animated.View> : null}
        </View> : null}
        {agenda.data.blocks.length ? <View testID="agenda-blocks" className="gap-3"><Text className="text-lg font-semibold text-ink">{t('blocks.title')}</Text>{agenda.data.blocks.map(block => <TimeBlockRow key={block.id} block={block} t={t} locale={blockDialog.locale} {...removal} />)}</View> : null}
      </>}
  </ScrollView>;
}

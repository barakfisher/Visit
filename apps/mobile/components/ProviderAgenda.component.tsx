import { tokens } from '@/src/design/tokens';
import { ManualBooking } from './ManualBooking.component';
import { AppointmentAudit } from './AppointmentAudit.component';
import { AppText as Text } from './AppText';
import { BusinessSwitcher } from './BusinessSwitcher.component';
import { Link } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';
import { ActionButton } from './ActionButton';
import { AddButton } from './AddButton';
import { TimeBlockRow } from './TimeBlocks';
import { TimeBlockDialog } from './TimeBlockForm.component';
import { formatMoney } from '../src/types/flows';
import type { ProviderAgendaView } from '../src/types/ProviderAgenda.types';
const field = 'rounded-control border border-line bg-surface px-4 py-3 text-ink';
/** `published` comes from publication readiness; the agenda itself does not load it. */
export function ProviderAgenda({ published, ...view }: ProviderAgendaView & { published: boolean }) {
  const { business, profile, t, day, draft, agenda, busy, feedback, update } = view;
  const { blockDialog, blockRemoval } = view, { removeFailure: _shownAsFeedback, ...removal } = blockRemoval;
  return <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 py-6 pb-10" className="flex-1 bg-canvas">
    <View className="gap-2"><Text className="text-xs font-semibold uppercase tracking-widest text-brand">{t('dashboard.workspace')}</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{business.name}</Text></View>
    <BusinessSwitcher businesses={profile?.businesses ?? []} activeId={business.id} onSelect={view.selectBusiness} />
    {/* Publishing lives in business settings; the agenda only points there (decisions.md, 2026-11-02). */}
    {published ? <Link testID="dashboard-share" href={{ pathname: '/provider/[businessId]/share', params: { businessId: business.id } }} className="min-h-touch py-3 font-semibold text-brand">{t('dashboard.share')}</Link>
      : <View testID="dashboard-unpublished" className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-amber-300 bg-amber-50 px-4 py-3"><Text className="flex-1 text-sm text-warning">{t('dashboard.unpublished')}</Text><Link href={{ pathname: '/provider/[businessId]/[section]', params: { businessId: business.id, section: 'publish' } }} className="min-h-touch py-2 font-semibold text-warning underline">{t('dashboard.publishLink')}</Link></View>}
      <ManualBooking {...view.manual} />
      <View className="flex-row flex-wrap gap-2"><ActionButton secondary label={t('agendaEdit.day')} onPress={() => update({ mode: 'day' })} disabled={busy || draft.mode === 'day'} /><ActionButton secondary label={t('agendaEdit.week')} onPress={() => update({ mode: 'week' })} disabled={busy || draft.mode === 'week'} /><ActionButton secondary label={t('agendaEdit.previous')} onPress={view.previous} disabled={busy || !view.validDate} /><ActionButton secondary label={t('agendaEdit.next')} onPress={view.next} disabled={busy || !view.validDate} /></View>
      {draft.mode === 'week' && agenda.data ? <Text accessibilityRole="header">{agenda.data.fromDate} – {agenda.data.toDate}</Text> : null}
      <TextInput accessibilityLabel={t('dashboard.date')} placeholderTextColor={tokens.color.disabled} placeholder="YYYY-MM-DD" value={day} onChangeText={date => update({ date })} className={field}/><Text className="text-sm text-muted">{view.timeNote}</Text>
      <View className="flex-row flex-wrap gap-3"><View className="min-w-40 flex-1 gap-2 rounded-card bg-brand p-5"><Text className="text-sm text-teal-50">{t('dashboard.appointments')}</Text><Text className="text-3xl font-bold text-white">{agenda.data?.summary.appointments ?? '—'}</Text></View><View className="min-w-40 flex-1 gap-2 rounded-card border border-line bg-surface p-5"><Text className="text-sm text-muted">{t('dashboard.revenue')}</Text><Text className="text-xl font-bold text-ink">{agenda.data ? Object.entries(agenda.data.summary.revenue).map(([currency, amount]) => formatMoney(amount, currency)).join(' · ') || '—' : '—'}</Text></View></View>
      {agenda.data?.staff.map(staff => <Text key={staff.id} className="text-sm text-muted">{staff.displayName} · {t('agendaEdit.capacity', { count: staff.parallelCapacity })}</Text>)}
      {/* The same dialog as the hours screen, starting on the agenda's date (decisions.md, "Time blocks with a reason"). */}
      <View className="self-start"><AddButton testID="agenda-block" label={t('dashboard.block')} disabled={busy || !view.validDate || !agenda.data} onPress={() => blockDialog.openDialog(day)} /></View>
      <TimeBlockDialog staff={agenda.data?.staff ?? []} {...blockDialog} />
      {feedback ? <Text accessibilityRole="alert" className="text-danger">{feedback}</Text> : null}
      {!view.validDate ? null : agenda.isError ? <View className="gap-2"><Text accessibilityRole="alert">{t('agendaEdit.loadFailure')}</Text><ActionButton secondary label={t('common.retry')} onPress={view.retry} /></View> : agenda.isLoading ? <Text className="text-body">{t('dashboard.loading')}</Text> : <>
        <Text className="text-xl font-semibold text-ink">{t(draft.mode === 'week' ? 'agendaEdit.weekly' : 'dashboard.daily')}</Text>{!agenda.data?.bookings.length ? <Text className="text-body">{t(draft.mode === 'week' ? 'agendaEdit.emptyWeek' : 'dashboard.empty')}</Text> : agenda.data.bookings.map((booking) => <View key={booking.id} testID={`agenda-booking-${booking.id}`} className="gap-3 rounded-card border border-line bg-surface p-5"><Text className="font-bold text-brand">{view.when(booking.startsAt)} – {view.when(booking.endsAt)}</Text><Text className="text-lg font-semibold text-ink">{booking.service.name}</Text>{booking.source === 'MANUAL' ? <Text className="text-sm text-muted">{t('manual.tag')}{booking.manualReason ? ` · ${booking.manualReason}` : ''}</Text> : null}<AppointmentAudit key={`${business.id}:${booking.id}`} booking={booking} timezone={business.timezone} businessId={business.id} />{booking.customer.displayName ? <Text className="font-semibold text-ink">{booking.customer.displayName}</Text> : null}<Text className="text-sm text-body">{booking.staff.displayName} · {booking.customer.phone ?? booking.customer.email ?? t('dashboard.customer')}</Text><View className="flex-row gap-2"><View className="flex-1"><ActionButton secondary label={t(booking.customer.phone ? 'dashboard.call' : 'dashboard.noPhoneCall')} disabled={!booking.customer.phone} onPress={() => view.contact(booking.customer.phone, 'call')}/></View><View className="flex-1"><ActionButton secondary label={t(booking.customer.phone ? 'dashboard.whatsapp' : 'dashboard.noPhoneWhatsapp')} disabled={!booking.customer.phone} onPress={() => view.contact(booking.customer.phone, 'whatsapp')}/></View></View></View>)}
        {agenda.data?.blocks.length ? <View testID="agenda-blocks" className="gap-3"><Text className="text-lg font-semibold text-ink">{t('blocks.title')}</Text>{agenda.data.blocks.map(block => <TimeBlockRow key={block.id} block={block} t={t} locale={blockDialog.locale} {...removal} />)}</View> : null}
      </>}
  </ScrollView>;
}

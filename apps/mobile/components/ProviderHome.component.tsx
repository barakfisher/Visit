import type { ComponentType } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { CardLink } from './CardLink.component';
import { DirectionalChevron } from './DirectionalChevron.component';
import { CalendarIcon, SmsIcon } from './AppointmentActionIcons.component';
import { InfoIcon, PlusIcon } from './NavigationIcons.component';
import { SmoothReveal } from './SmoothHeight.component';
import type { ProviderHomePanel, ProviderHomeView } from '@/src/types/ProviderHome.types';

type Tile = { key: string; title: string; summary: string; Icon: ComponentType<{ color: string }>; onPress: () => void; panel?: ProviderHomePanel };
const pairs = <T,>(items: T[]) => items.flatMap((item, index) => index % 2 ? [] : [[item, items[index + 1]] as [T, T | undefined]]);

/** The next appointment stands apart, because its date and its own actions do not fit a square; the rest are tiles in rows of two. */
export function ProviderHome(view: ProviderHomeView) {
  const { t } = view;
  if (view.state === 'loading') return <View className="flex-1 items-center justify-center bg-canvas"><ActivityIndicator accessibilityLabel={t('common.loading')} color={tokens.color.brand} /></View>;
  if (view.state !== 'ready') return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-3 px-5 py-6 md:px-8">
    <AppText accessibilityRole="alert">{t(view.state === 'unavailable' ? 'providerHome.unavailable' : 'providerHome.loadFailed')}</AppText>
    {view.state === 'error' ? <ActionButton secondary label={t('common.retry')} onPress={view.onRetry} /> : null}
  </ScrollView>;
  const tiles: Tile[] = [
    { key: 'book', title: t('providerHome.book'), summary: t('providerHome.bookSummary'), Icon: PlusIcon, onPress: view.onBook },
    ...(view.appointmentsState === 'hidden' ? [] : [{ key: 'mine', title: t('providerHome.mine'), summary: view.appointmentsState === 'ready' ? view.mineSummary : '', Icon: CalendarIcon, onPress: view.onMine }]),
    ...(view.contacts ? [{ key: 'contact', title: t('providerHome.contact'), summary: view.contactSummary, Icon: SmsIcon, onPress: () => view.onPanel('contact'), panel: 'contact' as const }] : []),
    { key: 'about', title: t('providerHome.about'), summary: t('providerHome.aboutSummary'), Icon: InfoIcon, onPress: () => view.onPanel('about'), panel: 'about' },
  ];
  const next = view.next;
  return <ScrollView testID="provider-home" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-6 md:px-8">
    <View className="gap-0.5">
      <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{view.name}</AppText>
      {view.listing ? <AppText className="text-body">{view.listing}</AppText> : null}
    </View>
    {view.appointmentsState === 'error' ? <View className="gap-3 rounded-card border border-line bg-surface p-4"><AppText accessibilityRole="alert">{t('providerHome.appointmentsFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={view.onRetryAppointments} /></View> : null}
    {/* The appointments arrive after the business; the card grows into place instead of pushing the tiles down in one jump. */}
    <View className="-mt-5"><SmoothReveal>{next ? <View className="pt-5"><CardLink testID={`provider-next-${next.id}`} label={[t('providerHome.next'), next.when, next.what].join(', ')} onPress={next.onOpen} contentClassName="gap-3 p-4">
      {/* The whole card opens the appointment; its buttons sit above that link, not inside it (a button inside a button is invalid on web). */}
      <CardLink.Passive hidden className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <AppText className="text-sm font-semibold text-brand">{t('providerHome.next')}</AppText>
          <AppText className="text-lg font-semibold text-ink">{next.when}</AppText>
          <AppText className="text-sm text-body">{next.what}</AppText>
        </View>
        <DirectionalChevron pointing="forward" color={tokens.color.muted} />
      </CardLink.Passive>
      {next.onReschedule || next.onCancel ? <View className="flex-row gap-3">
        {next.onReschedule ? <View className="flex-1"><ActionButton secondary label={t('ui.reschedule')} disabled={next.busy} onPress={next.onReschedule} /></View> : null}
        {next.onCancel ? <View className="flex-1"><ActionButton secondary label={t('ui.cancel')} busy={next.busy} onPress={next.onCancel} /></View> : null}
      </View> : null}
      {next.note ? <CardLink.Passive><AppText className="text-sm text-muted">{next.note}</AppText></CardLink.Passive> : null}
      {next.error ? <CardLink.Passive><AppText accessibilityRole="alert" accessibilityLiveRegion="assertive" className="rounded-control bg-red-50 p-3 text-danger">{next.error}</AppText></CardLink.Passive> : null}
    </CardLink></View> : null}</SmoothReveal></View>
    <View className="gap-3">
      {/* Rows of two at every width; the spacer keeps a lone last tile the same width as the others. */}
      {pairs(tiles).map(([first, second]) => <View key={first.key} className="flex-row gap-3">
        {[first, second].map((tile, index) => <View key={tile?.key ?? `spacer-${index}`} className="flex-1">{tile ? <ProviderTile tile={tile} open={!!tile.panel && view.panel === tile.panel} /> : null}</View>)}
      </View>)}
    </View>
    {view.panel === 'contact' && view.contacts ? <View testID="provider-contact" className="gap-4 rounded-card border border-line bg-surface p-4">
      {view.contacts.phone ? <ContactRow label={t('providerHome.phone')} value={view.contacts.phone} action={t('providerHome.call')} onPress={view.onCall} /> : null}
      {view.contacts.email ? <ContactRow label={t('providerHome.email')} value={view.contacts.email} action={t('providerHome.write')} onPress={view.onWrite} /> : null}
      {view.contacts.location ? <ContactRow label={t('providerHome.address')} value={view.contacts.location} /> : null}
    </View> : null}
    {view.panel === 'about' ? <View testID="provider-about" className="gap-4 rounded-card border border-line bg-surface p-4">
      {view.description ? <AppText className="text-body">{view.description}</AppText> : null}
      <View className="gap-2">
        <AppText accessibilityRole="header" className="font-semibold text-ink">{t('providerHome.services')}</AppText>
        {view.services.map(service => <View key={service.id} className="flex-row flex-wrap justify-between gap-x-3"><AppText className="text-ink">{service.name}</AppText><AppText className="text-body">{service.summary}</AppText></View>)}
      </View>
      <View className="gap-2">
        <AppText accessibilityRole="header" className="font-semibold text-ink">{t('providerHome.hours')}</AppText>
        {view.hours.length ? view.hours.map(row => <AppText key={row.days} className="text-ink"><AppText className="font-semibold">{row.days}:</AppText> {row.hours}</AppText>) : <AppText className="text-body">{t('providerHome.noHours')}</AppText>}
      </View>
    </View> : null}
  </ScrollView>;
}

function ProviderTile({ tile, open }: { tile: Tile; open: boolean }) {
  return <Control testID={`provider-tile-${tile.key}`} accessibilityRole="button" aria-expanded={tile.panel ? open : undefined} onPress={tile.onPress}
    style={{ minHeight: 128 }} className={`justify-between gap-3 rounded-card border p-4 active:bg-brand-soft ${open ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
    <tile.Icon color={tokens.color.brand} />
    <View className="gap-0.5">
      <AppText className="font-semibold text-ink">{tile.title}</AppText>
      {tile.summary ? <AppText className="text-sm text-body">{tile.summary}</AppText> : null}
    </View>
  </Control>;
}

function ContactRow({ label, value, action, onPress }: { label: string; value: string; action?: string; onPress?: () => void }) {
  return <View className="flex-row flex-wrap items-center justify-between gap-3">
    <View className="shrink gap-0.5"><AppText className="text-sm text-body">{label}</AppText><AppText selectable className="font-semibold text-ink">{`⁦${value}⁩`}</AppText></View>
    {action && onPress ? <ActionButton secondary label={action} onPress={onPress} /> : null}
  </View>;
}

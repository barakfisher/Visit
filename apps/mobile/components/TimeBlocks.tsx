import { ActivityIndicator, View } from 'react-native';
import type { Locale, MessageKey } from '@/src/i18n/messages';
import { blockDates, ltr } from '@/src/lib/TimeBlocks';
import type { BlockRemovalState, TimeBlocksState } from '@/src/lib/TimeBlocks.hook';
import type { TimeBlock } from '@/src/types/TimeBlocks.types';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { AddButton } from './AddButton';
import { TimeBlockDialog } from './TimeBlockForm.component';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** One block: who, when ("All day" or its hours), the reason, and removal that asks first. */
export function TimeBlockRow({ block, t, locale, removing, pending, askRemove, confirmRemove }: { block: TimeBlock; t: Translate; locale: Locale } & Omit<BlockRemovalState, 'removeFailure'>) {
  const hours = block.allDay || !block.startLocal || !block.endLocal ? t('blocks.allDay') : ltr(`${block.startLocal}–${block.endLocal}`);
  const busy = Boolean(pending);
  return <View testID={`time-block-${block.id}`} className="gap-2 rounded-control border border-line bg-canvas p-4">
    <AppText className="font-semibold text-ink">{blockDates(block, locale)} · {hours}</AppText>
    <AppText className="text-sm text-body">{block.staff?.displayName ?? t('blocks.wholeBusiness')}{block.reason ? ` · ${block.reason}` : ''}</AppText>
    {removing === block.id ? <View className="gap-3">
      <AppText>{t('blocks.removeHelp')}</AppText>
      <View className="flex-row gap-3">
        <View className="flex-1"><ActionButton busy={pending === block.id} disabled={busy && pending !== block.id} label={t('blocks.confirmRemove')} onPress={() => confirmRemove(block.id)} /></View>
        <View className="flex-1"><ActionButton secondary disabled={busy} label={t('blocks.back')} onPress={() => askRemove(null)} /></View>
      </View>
    </View> : <View className="self-start"><ActionButton secondary disabled={busy} label={t('blocks.remove')} onPress={() => askRemove(block.id)} /></View>}
  </View>;
}

/** The hours screen's blocked-time section: upcoming blocks for the whole business and each staff member. */
export function TimeBlocks(state: TimeBlocksState) {
  const { t, locale, direction, dialog, blocks, loading, failed, ready, staff, message, removeFailure, retry, openDialog, removing, pending, askRemove, confirmRemove } = state;
  return <View testID="time-blocks" className="gap-4" style={{ direction }}>
    <View className="flex-row flex-wrap items-center justify-between gap-3">
      <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('blocks.title')}</AppText>
      {ready ? <AddButton testID="block-add" label={t('blocks.add')} disabled={dialog.busy} onPress={openDialog} /> : null}
    </View>
    <AppText className="text-sm text-body">{t('blocks.hint')}</AppText>
    {loading ? <ActivityIndicator accessibilityLabel={t('common.loading')} />
      : failed ? <><AppText accessibilityRole="alert">{t('blocks.loadFailed')}</AppText><View className="self-start"><ActionButton secondary label={t('common.retry')} onPress={retry} /></View></>
      : !blocks.length ? <AppText testID="time-blocks-empty">{t('blocks.empty')}</AppText>
      : <View className="gap-3">{blocks.map(block => <TimeBlockRow key={block.id} block={block} t={t} locale={locale} removing={removing} pending={pending} askRemove={askRemove} confirmRemove={confirmRemove} />)}</View>}
    {removeFailure ? <AppText accessibilityRole="alert" className="text-danger">{t(removeFailure)}</AppText> : null}
    {message ? <AppText role="status">{t(message)}</AppText> : null}
    <TimeBlockDialog staff={staff} {...dialog} />
  </View>;
}

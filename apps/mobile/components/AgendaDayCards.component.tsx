import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { ltr } from '@/src/lib/TimeBlocks';
import type { FreeGap } from '@/src/lib/AgendaToday.utils';
import type { TimeBlock } from '@/src/types/TimeBlocks.types';
import type { ProviderAgendaView } from '@/src/types/ProviderAgenda.types';
import { AppText as Text } from './AppText';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';

/*
 * The cards between today's appointments (decisions.md, "The business day as cards" — 2026-11-11).
 * Each card's visible text is its accessible name: a separate label around direction-isolated times fails axe.
 */
type Translate = ProviderAgendaView['t'];

/** Free time inside the working hours: grey, with a plus, and a tap opens Add appointment at its start. */
export function FreeTimeCard({ gap, t, staffName, onPress }: { gap: FreeGap; t: Translate; staffName: boolean; onPress: () => void }) {
  return <Control testID={`agenda-free-${gap.staffId}-${gap.startLocal}`} accessibilityRole="button" onPress={onPress}
    className="flex-row items-center gap-3 rounded-card border border-dashed border-line bg-slate-100 px-4 py-3 active:bg-brand-soft">
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: tokens.color.surface, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 12, height: 2, borderRadius: 1, backgroundColor: tokens.color.brand }} />
      <View style={{ position: 'absolute', width: 2, height: 12, borderRadius: 1, backgroundColor: tokens.color.brand }} />
    </View>
    <View className="flex-1 gap-0.5">
      <Text className="font-semibold text-brand">{t('dashboard.addHere')}</Text>
      <Text className="text-sm text-body">{t('dashboard.free', { span: ltr(`${gap.startLocal}–${gap.endLocal}`) })}{staffName ? ` · ${gap.staffName}` : ''}</Text>
    </View>
  </Control>;
}

/** Hours a block covers today: its own hours, or "All day" for a whole-day block. */
const blockSpan = (block: TimeBlock, t: Translate) => block.allDay || !block.startLocal || !block.endLocal ? t('blocks.allDay') : ltr(`${block.startLocal}–${block.endLocal}`);

/** A block: amber, with its reason, and a tap opens its details where it can be released. */
export function BlockCard({ block, t, onPress }: { block: TimeBlock; t: Translate; onPress: () => void }) {
  return <Control testID={`agenda-blocked-${block.id}`} accessibilityRole="button" onPress={onPress}
    className="flex-row items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 active:bg-amber-100">
    <View className="flex-1 gap-0.5">
      <Text className="font-semibold text-warning">{block.reason || t('dashboard.blocked')}</Text>
      <Text className="text-sm text-body">{blockSpan(block, t)}{block.staff ? ` · ${block.staff.displayName}` : ''}</Text>
    </View>
    <DirectionalChevron pointing="forward" color={tokens.color.warning} />
  </Control>;
}

/** A day with no weekly hours. Releasing a block cannot open it, so the card points to the hours instead. */
export function ClosedDayCard({ t, onHours }: { t: Translate; onHours: () => void }) {
  return <View testID="agenda-closed" className="gap-2 rounded-card border border-line bg-slate-200 px-4 py-3">
    <Text className="font-semibold text-ink">{t('dashboard.closed')}</Text>
    <Text className="text-sm text-body">{t('dashboard.closedHelp')}</Text>
    <Control accessibilityRole="link" onPress={onHours} className="flex-row items-center gap-1 self-start">
      <Text className="font-semibold text-ink underline">{t('dashboard.closedHours')}</Text>
    </Control>
  </View>;
}

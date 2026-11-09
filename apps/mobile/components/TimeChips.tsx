import { View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { itemArrives, itemLeaves, itemMoves } from '@/src/design/motion';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { TimeChip } from './TimeChip';
export type TimeChoice = { id: string; label: string; disabled?: boolean; locked?: boolean };
export function TimeChips({ slots, timezone, selectedId, loading = false, busy = false, onSelect }: { slots: TimeChoice[]; timezone: string; selectedId?: string | null; loading?: boolean; busy?: boolean; onSelect?: (id: string) => void }) {
  const { t } = useAppLocale();
  // Times already there when the list first appears are simply there; only later arrivals fade in.
  return <LayoutAnimationConfig skipEntering><View role={loading ? 'status' : 'group'} accessibilityLabel={t(loading ? 'ui.timesLoading' : 'ui.times')} aria-busy={loading || busy} accessibilityState={{ busy: loading || busy }} className="flex-row flex-wrap gap-3">
    {loading ? Array.from({ length: 6 }, (_, index) => <View key={index} accessible={false} className="h-20 w-28 rounded-control bg-line" />) : slots.map((slot) => <Animated.View key={slot.id} layout={itemMoves} entering={itemArrives} exiting={itemLeaves}><TimeChip label={slot.label} timezone={timezone} selected={slot.id === selectedId} disabled={busy || slot.disabled} locked={slot.locked} onPress={() => onSelect?.(slot.id)} /></Animated.View>)}
  </View></LayoutAnimationConfig>;
}

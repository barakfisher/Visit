import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { TimeChip } from './TimeChip';
export type TimeChoice = { id: string; label: string; disabled?: boolean; locked?: boolean };
export function TimeChips({ slots, timezone, selectedId, loading = false, busy = false, onSelect }: { slots: TimeChoice[]; timezone: string; selectedId?: string | null; loading?: boolean; busy?: boolean; onSelect?: (id: string) => void }) {
  const { t } = useAppLocale();
  return <View role={loading ? 'status' : 'group'} accessibilityLabel={t(loading ? 'ui.timesLoading' : 'ui.times')} aria-busy={loading || busy} accessibilityState={{ busy: loading || busy }} className="flex-row flex-wrap gap-3">
    {loading ? Array.from({ length: 6 }, (_, index) => <View key={index} accessible={false} className="h-20 w-28 rounded-control bg-line" />) : slots.map((slot) => <TimeChip key={slot.id} label={slot.label} timezone={timezone} selected={slot.id === selectedId} disabled={busy || slot.disabled} locked={slot.locked} onPress={() => onSelect?.(slot.id)} />)}
  </View>;
}

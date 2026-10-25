import { ScrollView } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { Control } from './Control';
export type CalendarDay = { id: string; label: string; dateLabel: string; accessibilityLabel: string; disabled?: boolean };
export function HorizontalCalendarBar({ days, selectedId, onSelect }: { days: CalendarDay[]; selectedId?: string; onSelect?: (id: string) => void }) {
  const { t, direction } = useAppLocale();
  return <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel={t('ui.dates')} style={{ direction }} contentContainerClassName="gap-3 px-2 py-2">
    {days.map(day => {
      const selected = day.id === selectedId;
      const status = day.disabled ? t('ui.closed') : selected ? `✓ ${t('ui.selected')}` : '';
      return <Control key={day.id} accessibilityRole="button" accessibilityLabel={`${day.label}${day.dateLabel}${status}, ${day.accessibilityLabel}`}
        aria-pressed={selected} accessibilityState={{ selected, disabled: !!day.disabled }} disabled={day.disabled} onPress={() => onSelect?.(day.id)}
        className={`min-w-20 items-center gap-1 rounded-control border px-3 py-3 ${day.disabled ? 'border-control-line bg-canvas' : selected ? 'border-brand bg-brand' : 'border-control-line bg-surface active:border-brand'}`}>
        <Text style={{ textAlign: 'center' }} className={`text-sm font-medium ${selected && !day.disabled ? 'text-white' : 'text-muted'}`}>{day.label}</Text>
        <Text style={{ textAlign: 'center' }} className={`text-lg font-semibold ${selected && !day.disabled ? 'text-white' : 'text-ink'}`}>{day.dateLabel}</Text>
        {day.disabled || selected ? <Text style={{ textAlign: 'center' }} className={`text-sm ${selected && !day.disabled ? 'text-white' : 'text-body'}`}>{day.disabled ? t('ui.closed') : `✓ ${t('ui.selected')}`}</Text> : null}
      </Control>;
    })}
  </ScrollView>;
}

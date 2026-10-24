import { ScrollView, Pressable, Text } from 'react-native';

export type CalendarDay = { id: string; label: string; dateLabel: string; accessibilityLabel: string; disabled?: boolean };

export function HorizontalCalendarBar({ days, selectedId, onSelect }: { days: CalendarDay[]; selectedId?: string; onSelect?: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Available dates" contentContainerClassName="gap-3 px-1 py-2">
      {days.map((day) => {
        const selected = day.id === selectedId;
        return (
          <Pressable
            key={day.id}
            accessibilityRole="button"
            accessibilityHint={day.accessibilityLabel}
            accessibilityState={{ selected, disabled: day.disabled }}
            disabled={day.disabled}
            onPress={() => onSelect?.(day.id)}
            className={`min-w-20 items-center gap-1 rounded-control border px-3 py-3 focus-visible:border-focus ${selected ? 'border-brand bg-brand text-white' : 'border-line bg-surface'} ${day.disabled ? 'opacity-40' : 'active:border-brand'}`}
          >
            <Text className={`text-xs font-medium ${selected ? 'text-teal-50' : 'text-muted'}`}>{day.label}</Text>
            <Text className={`text-lg font-semibold ${selected ? 'text-white' : 'text-ink'}`}>{day.dateLabel}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

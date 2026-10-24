import { Pressable, Text } from 'react-native';

export type TimeChipProps = {
  label: string;
  timezone: string;
  selected?: boolean;
  locked?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

export function TimeChip({ label, timezone, selected = false, locked = false, disabled = false, onPress }: TimeChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: disabled || locked }}
      disabled={disabled || locked}
      onPress={onPress}
      className={`min-w-24 items-center rounded-control border px-4 py-3 focus-visible:border-focus ${selected ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink'} ${disabled || locked ? 'bg-canvas opacity-50' : 'active:border-brand'}`}
    >
      <Text className={`font-semibold ${selected ? 'text-white' : 'text-ink'}`}>{label}</Text>
      <Text className={`mt-1 text-xs ${selected ? 'text-teal-50' : 'text-muted'}`}>{locked ? 'Held by another customer' : timezone}</Text>
    </Pressable>
  );
}

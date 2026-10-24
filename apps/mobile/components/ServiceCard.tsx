import { Pressable, Text, View } from 'react-native';

export type ServiceCardProps = {
  name: string;
  description?: string;
  durationMinutes: number;
  priceLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

export function ServiceCard({ name, description, durationMinutes, priceLabel, selected = false, disabled = false, onPress }: ServiceCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`gap-3 rounded-card border bg-surface p-card shadow-card focus-visible:border-focus focus-visible:outline-none ${selected ? 'border-brand bg-brand-soft' : 'border-line'} ${disabled ? 'opacity-50' : 'active:border-brand'}`}
    >
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-lg font-semibold text-ink">{name}</Text>
          {description ? <Text className="text-sm leading-5 text-body">{description}</Text> : null}
        </View>
        {priceLabel ? <Text className="font-semibold text-ink">{priceLabel}</Text> : null}
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-muted">{durationMinutes} min</Text>
        {selected ? <Text className="text-sm font-semibold text-brand">Selected</Text> : null}
      </View>
    </Pressable>
  );
}

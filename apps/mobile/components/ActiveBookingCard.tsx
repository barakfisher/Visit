import { Pressable, Text, View } from 'react-native';

export type ActiveBookingCardProps = {
  service: string;
  provider: string;
  dateLabel: string;
  timeLabel: string;
  timezone: string;
  onReschedule?: () => void;
  onCancel?: () => void;
};

export function ActiveBookingCard({ service, provider, dateLabel, timeLabel, timezone, onReschedule, onCancel }: ActiveBookingCardProps) {
  return (
    <View accessibilityLabel="Upcoming appointment" className="gap-4 rounded-card border border-line bg-surface p-card shadow-card">
      <View className="gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-brand">Your next visit</Text>
        <Text className="text-lg font-semibold text-ink">{service}</Text>
        <Text className="text-sm text-body">with {provider}</Text>
      </View>
      <View className="rounded-control bg-canvas p-3">
        <Text className="font-semibold text-ink">{dateLabel} · {timeLabel}</Text>
        <Text className="mt-1 text-sm text-muted">{timezone}</Text>
      </View>
      <View className="flex-row gap-3">
        {onReschedule ? <Pressable accessibilityRole="button" onPress={onReschedule} className="flex-1 items-center rounded-control border border-brand px-4 py-3 focus-visible:border-focus active:bg-brand-soft"><Text className="font-semibold text-brand">Reschedule</Text></Pressable> : null}
        {onCancel ? <Pressable accessibilityRole="button" onPress={onCancel} className="items-center rounded-control px-4 py-3 focus-visible:border-focus"><Text className="font-semibold text-danger">Cancel</Text></Pressable> : null}
      </View>
    </View>
  );
}

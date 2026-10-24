import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export type AvailabilityStateProps = { state: 'loading' | 'empty' | 'error' | 'available'; onRetry?: () => void };

const content = {
  loading: { title: 'Checking availability', message: 'Finding appointment times that fit.' },
  empty: { title: 'No times available', message: 'Try another date or check back soon.' },
  error: { title: 'Availability could not load', message: 'Your booking is not affected. Try again in a moment.' },
  available: { title: 'Times available', message: 'Choose a time that works for you.' },
} as const;

export function AvailabilityState({ state, onRetry }: AvailabilityStateProps) {
  const { title, message } = content[state];
  return (
    <View accessibilityRole={state === 'error' ? 'alert' : undefined} className="items-center gap-2 rounded-card border border-line bg-surface p-card">
      {state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading availability" color="#0f766e" /> : null}
      <Text className="font-semibold text-ink">{title}</Text>
      <Text className="text-center text-sm leading-5 text-body">{message}</Text>
      {state === 'error' ? <Pressable accessibilityRole="button" onPress={onRetry} className="mt-2 rounded-control bg-brand px-4 py-3 focus-visible:border-focus active:bg-brand-pressed"><Text className="font-semibold text-white">Try again</Text></Pressable> : null}
    </View>
  );
}

import { View } from 'react-native';
import { AppText as Text } from '../AppText';
export function AuthHeader({ title, intro }: { title: string; intro: string }) {
  return <View className="gap-3"><View className="h-12 w-12 items-center justify-center rounded-control bg-brand"><Text className="text-2xl font-bold text-white">V</Text></View><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{title}</Text><Text className="leading-6 text-body">{intro}</Text></View>;
}

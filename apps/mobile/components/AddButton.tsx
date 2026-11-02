import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { Control } from './Control';

/** The look shared by the header row's Add and a card's Edit, so the two read as one family of actions. */
export const outlineActionClass = (disabled: boolean) => `flex-row items-center gap-2 rounded-control border px-4 py-2 ${disabled ? 'border-control-line bg-canvas' : 'border-brand bg-surface active:bg-brand-soft'}`;

/** The compact "+ Add …" action that sits in a list's header row (services and staff). */
export function AddButton({ label, onPress, disabled = false, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const color = disabled ? tokens.color.muted : tokens.color.brand;
  return <Control testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={outlineActionClass(disabled)}>
    {/* Two bars rather than an icon font or SVG: the app ships neither on web. */}
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 16, height: 2.5, borderRadius: 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: 2.5, height: 16, borderRadius: 2, backgroundColor: color }} />
    </View>
    <AppText className={`font-semibold ${disabled ? 'text-muted' : 'text-brand'}`}>{label}</AppText>
  </Control>;
}

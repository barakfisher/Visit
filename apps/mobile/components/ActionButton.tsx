import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { CompactControl } from './CompactControl.component';
// A secondary danger button (Cancel on a card) is a lighter red at a lighter weight: it must read as destructive, not shout.
const DANGER_SOFT = '#dc2626';
export function ActionButton({ label, onPress, disabled = false, busy = false, secondary = false, danger = false, dense = false, icon, testID }: { label: string; dense?: boolean; icon?: (color: string) => ReactNode; testID?: string; onPress?: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; danger?: boolean }) {
  return <CompactControl testID={testID} accessibilityRole="button" accessibilityLabel={label} aria-busy={busy} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} surfaceClassName={pressed => `items-center justify-center rounded-control border ${dense ? 'px-2' : 'px-5'} py-1 ${disabled ? 'border-control-line bg-canvas' : danger && secondary ? `border-red-200 ${pressed ? 'bg-red-50' : 'bg-surface'}` : danger ? 'border-danger bg-danger' : secondary ? `border-brand ${pressed ? 'bg-brand-soft' : 'bg-surface'}` : `border-brand ${pressed ? 'bg-brand-pressed' : 'bg-brand'}`}`}>
    {busy ? <ActivityIndicator accessibilityLabel={label} color={danger && secondary ? DANGER_SOFT : secondary ? tokens.color.brand : tokens.color.surface} /> : <View className={`flex-row items-center justify-center ${dense ? 'gap-1.5' : 'gap-2'}`}>{icon?.(disabled ? tokens.color.muted : danger && secondary ? DANGER_SOFT : secondary ? tokens.color.brand : tokens.color.surface)}<AppText style={{ textAlign: 'center' }} className={`text-base ${danger && secondary && !disabled ? '' : 'font-semibold'} ${disabled ? 'text-muted' : danger && secondary ? 'text-red-600 font-medium' : secondary ? 'text-brand' : 'text-white'}`}>{label}</AppText></View>}
  </CompactControl>;
}

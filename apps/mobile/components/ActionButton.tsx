import { ActivityIndicator } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { Control } from './Control';
export function ActionButton({ label, onPress, disabled = false, busy = false, secondary = false }: { label: string; onPress?: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean }) {
  return <Control accessibilityRole="button" accessibilityLabel={label} aria-busy={busy} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={{ minHeight: tokens.layout.actionHeight }} className={`min-h-action items-center justify-center rounded-control border px-5 py-4 ${disabled ? 'border-control-line bg-canvas' : secondary ? 'border-brand bg-surface active:bg-brand-soft' : 'border-brand bg-brand active:bg-brand-pressed'}`}>
    {busy ? <ActivityIndicator accessibilityLabel={label} color={secondary ? tokens.color.brand : tokens.color.surface} /> : <AppText style={{ textAlign: 'center' }} className={`text-base font-semibold ${disabled ? 'text-muted' : secondary ? 'text-brand' : 'text-white'}`}>{label}</AppText>}
  </Control>;
}

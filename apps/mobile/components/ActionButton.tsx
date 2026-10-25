import { ActivityIndicator, Pressable, Text } from 'react-native';
export function ActionButton({ label, onPress, disabled = false, busy = false, secondary = false }: { label: string; onPress?: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} className={`min-h-14 items-center justify-center rounded-control border px-5 py-4 ${disabled ? 'border-line bg-canvas' : secondary ? 'border-line bg-surface active:bg-brand-soft' : 'border-brand bg-brand active:bg-brand-pressed'}`}>
    {busy ? <ActivityIndicator color={secondary ? '#0f766e' : 'white'} /> : <Text className={`text-center font-semibold ${disabled ? 'text-muted' : secondary ? 'text-brand' : 'text-white'}`}>{label}</Text>}
  </Pressable>;
}

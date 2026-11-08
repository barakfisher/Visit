import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { Control } from './Control';

const TRACK = { width: 36, height: 20, padding: 2 };
const THUMB = TRACK.height - TRACK.padding * 2;

/**
 * Drawn rather than React Native's Switch: on web that one mixes logical and mirrored offsets, and under a
 * right-to-left document its thumb left the track. A row places the thumb by flow, so it follows the direction by itself.
 */
export function ModeSwitch({ label, accessibilityLabel, value, disabled, onChange }: { label: string; accessibilityLabel: string; value: boolean; disabled: boolean; onChange: () => void }) {
  return <Control accessibilityRole="switch" accessibilityLabel={accessibilityLabel} aria-checked={value} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={onChange} className="flex-row items-center justify-center gap-2 rounded-control">
    <AppText className="text-xs font-semibold text-muted">{label}</AppText>
    <View testID="mode-switch-track" style={{ ...TRACK, flexDirection: 'row', justifyContent: value ? 'flex-end' : 'flex-start', borderRadius: TRACK.height / 2, backgroundColor: value ? tokens.color.brand : tokens.color.muted, opacity: disabled ? 0.5 : 1 }}>
      <View testID="mode-switch-thumb" style={{ width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: tokens.color.surface }} />
    </View>
  </Control>;
}

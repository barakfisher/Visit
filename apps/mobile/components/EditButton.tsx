import { View } from 'react-native';
import { physicalDrawing } from '@/src/design/nativeDirection';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { Control } from './Control';
import { outlineActionClass } from './AddButton';

/** A card's "Edit": the same look as Add, with a chevron that turns when the section it controls is open. */
export function EditButton({ label, accessibilityLabel, expanded, onPress, disabled = false, testID }: { label: string; accessibilityLabel?: string; expanded: boolean; onPress: () => void; disabled?: boolean; testID?: string }) {
  const color = disabled ? tokens.color.muted : tokens.color.brand;
  return <Control testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} aria-expanded={expanded} accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={onPress} className={outlineActionClass(disabled)}>
    <AppText className={`font-semibold ${disabled ? 'text-muted' : 'text-brand'}`}>{label}</AppText>
    {/* Two borders of a turned square rather than an icon font or SVG: the app ships neither on web. */}
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ ...physicalDrawing, width: 8, height: 8, marginTop: expanded ? 4 : -4, borderColor: color, borderRightWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: expanded ? '-135deg' : '45deg' }] }} />
    </View>
  </Control>;
}

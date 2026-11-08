import { View } from 'react-native';
import { AppText } from './AppText';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';

/** A page's way back, at the start edge. */
export function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <View className="flex-row">
    {/* Negative margins let the 44px target overhang the page's gaps, so it looks and takes about 28px. */}
    <Control accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ marginVertical: -8 }} className="flex-row items-center gap-1 rounded-control pe-3 active:bg-brand-soft">
      <DirectionalChevron pointing="back" />
      <AppText className="text-sm font-semibold text-brand">{label}</AppText>
    </Control>
  </View>;
}

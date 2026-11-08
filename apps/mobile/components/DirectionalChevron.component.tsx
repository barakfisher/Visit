import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';

/** Points the way the reading direction goes back or forward. Two borders of a turned square rather than an icon font or SVG: the app ships neither on web. */
export function DirectionalChevron({ pointing, color = tokens.color.brand }: { pointing: 'back' | 'forward'; color?: string }) {
  const { direction } = useAppLocale();
  const pointsRight = (pointing === 'forward') === (direction === 'ltr');
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 9, height: 9, borderColor: color, borderLeftWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: pointsRight ? '-135deg' : '45deg' }] }} />
  </View>;
}

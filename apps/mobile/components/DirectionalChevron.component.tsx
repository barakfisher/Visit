import { View } from 'react-native';
import { physicalDrawing } from '@/src/design/nativeDirection';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';

/** Points the way the reading direction goes back or forward, or down and up for something that opens in place. Two borders of a turned square rather than an icon font or SVG: the app ships neither on web. */
export function DirectionalChevron({ pointing, color = tokens.color.brand }: { pointing: 'back' | 'forward' | 'down' | 'up'; color?: string }) {
  const { direction } = useAppLocale();
  const pointsRight = (pointing === 'forward') === (direction === 'ltr');
  const rotate = pointing === 'down' ? '-45deg' : pointing === 'up' ? '135deg' : pointsRight ? '-135deg' : '45deg';
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ ...physicalDrawing, width: 9, height: 9, borderColor: color, borderLeftWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate }] }} />
  </View>;
}

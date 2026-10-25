import { View, type ViewProps } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { tokens } from '@/src/design/tokens';
/** Place inside a screen ScrollView; never fixes height or clips enlarged text. */
export function ScreenContent({ form = false, style, ...props }: ViewProps & { form?: boolean }) {
  const { direction } = useAppLocale();
  return <View {...props} {...{ dir: direction }} style={[{ direction, width: '100%', maxWidth: form ? tokens.layout.formMaxWidth : tokens.layout.contentMaxWidth, alignSelf: 'center', padding: 20, gap: 20, minWidth: 0 }, style]} />;
}

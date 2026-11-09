import { Text, type TextProps, Platform } from 'react-native';
import { startAlignment } from '@/src/design/nativeDirection';
import { useAppLocale } from '@/src/i18n/LocaleContext';
export function AppText({ style, ...props }: TextProps) {
  const { locale, direction } = useAppLocale();
  return <Text {...props} accessibilityLanguage={locale === 'he' ? 'he-IL' : 'en-GB'} {...(Platform.OS === 'web' ? { lang: locale } : {})} style={[startAlignment(Platform.OS, direction), { writingDirection: direction }, style]} />;
}

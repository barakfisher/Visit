import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';
import { Control } from './Control';
import { GlobeIcon } from './NavigationIcons.component';
/** One small control naming the language it switches to; every press moves to the other one. */
export function LanguageSettings() {
  const { locale, t, setLocale, saving, error } = useAppLocale();
  const next = locale === 'he' ? 'en' : 'he';
  return <View className="gap-1 self-end">
    <Control testID={`language-${next}`} accessibilityRole="button" accessibilityLabel={t(`language.${next}`)} accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void setLocale(next)} className="flex-row items-center justify-center gap-1 rounded-control px-2 active:bg-brand-soft">
      <GlobeIcon color={tokens.color.brand} />
      <AppText className="text-sm font-semibold text-brand">{t(`language.${next}`)}</AppText>
    </Control>
    {error ? <AppText accessibilityRole="alert" className="text-sm text-warning">{t('language.saveError')}</AppText> : null}
  </View>;
}

import { Pressable, View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';
export function LanguageSettings() {
  const { locale, t, setLocale, saving, error } = useAppLocale();
  return <View className="gap-3 rounded-card border border-line bg-surface p-card">
    <AppText accessibilityRole="header" className="text-lg font-semibold text-ink">{t('language.title')}</AppText>
    <View className="flex-row gap-3">{(['he', 'en'] as const).map(value => <Pressable key={value} testID={`language-${value}`} accessibilityRole="button" aria-pressed={locale === value} accessibilityLabel={t(`language.${value}`)} accessibilityState={{ selected: locale === value, disabled: saving }} disabled={saving} onPress={() => void setLocale(value)} className={`min-h-12 flex-1 items-center justify-center rounded-control border px-4 py-3 ${locale === value ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}><AppText style={{ textAlign: 'center' }} className="font-semibold text-brand">{t(`language.${value}`)}{locale === value ? ' ✓' : ''}</AppText></Pressable>)}</View>
    {error ? <AppText accessibilityRole="alert" className="text-sm text-warning">{t('language.saveError')}</AppText> : null}
  </View>;
}

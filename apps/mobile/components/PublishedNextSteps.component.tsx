import { View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import type { useAppLocale } from '@/src/i18n/LocaleContext';
/** Once a business is published: sharing brings the first customers, so it leads; the agenda follows (decisions.md, 2026-11-03).
 *  The screen supplies the navigation, so this stays free of router hooks for Storybook. */
export function PublishedNextSteps({ t, onShare, onAgenda }: { t: ReturnType<typeof useAppLocale>['t']; onShare: () => void; onAgenda: () => void }) {
  return <View testID="published-next-steps" className="gap-3 rounded-card border border-brand bg-brand-soft p-card">
    <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('published.title')}</AppText>
    <AppText className="leading-6 text-body">{t('published.intro')}</AppText>
    <ActionButton label={t('published.share')} onPress={onShare} />
    <ActionButton secondary label={t('published.agenda')} onPress={onAgenda} />
  </View>;
}

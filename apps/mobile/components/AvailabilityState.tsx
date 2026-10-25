import { ActivityIndicator, View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
export type AvailabilityStateProps = { state: 'loading' | 'empty' | 'error' | 'available'; onRetry?: () => void };
export function AvailabilityState({ state, onRetry }: AvailabilityStateProps) {
  const { t } = useAppLocale();
  return <View accessibilityRole={state === 'error' ? 'alert' : undefined} accessibilityLiveRegion={state === 'loading' ? 'polite' : 'none'} className="items-center gap-2 rounded-card border border-line bg-surface p-card">
    {state === 'loading' ? <ActivityIndicator accessibilityLabel={t('ui.timesLoading')} color={tokens.color.brand} /> : null}
    <Text className="font-semibold text-ink">{t(`ui.${state}.title`)}</Text>
    <Text style={{ textAlign: 'center' }} className="text-sm leading-5 text-body">{t(`ui.${state}.message`)}</Text>
    {state === 'error' && onRetry ? <ActionButton label={t('ui.retry')} onPress={onRetry} /> : null}
  </View>;
}

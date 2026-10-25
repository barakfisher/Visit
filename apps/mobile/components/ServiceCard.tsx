import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { Control } from './Control';
export type ServiceCardProps = { name: string; description?: string; durationMinutes: number; priceLabel?: string; selected?: boolean; disabled?: boolean; onPress?: () => void };
export function ServiceCard({ name, description, durationMinutes, priceLabel, selected = false, disabled = false, onPress }: ServiceCardProps) {
  const { t } = useAppLocale();
  return <Control accessibilityRole="button" aria-pressed={selected} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    className={`gap-3 rounded-card border p-card shadow-card ${disabled ? 'border-control-line bg-canvas' : selected ? 'border-brand bg-brand-soft' : 'border-control-line bg-surface active:border-brand'}`}>
    <View className="flex-row flex-wrap items-start justify-between gap-4">
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 }} className="gap-1">
        <Text className="text-lg font-semibold text-ink">{name}</Text>
        {description ? <Text className="text-sm leading-5 text-body">{description}</Text> : null}
      </View>
      {priceLabel ? <Text style={{ flexShrink: 1, writingDirection: 'ltr' }} className="font-semibold text-ink">{priceLabel}</Text> : null}
    </View>
    <View className="flex-row flex-wrap items-center justify-between gap-2">
      <Text className="text-sm text-body">{t('ui.minutes', { minutes: durationMinutes })}</Text>
      {disabled || selected ? <Text className="text-sm font-semibold text-brand">{disabled ? t('ui.unavailable') : `✓ ${t('ui.selected')}`}</Text> : null}
    </View>
  </Control>;
}

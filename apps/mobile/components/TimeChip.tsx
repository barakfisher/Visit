import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { Control } from './Control';
export type TimeChipProps = { label: string; timezone: string; selected?: boolean; locked?: boolean; disabled?: boolean; onPress?: () => void };
export function TimeChip({ label, timezone, selected = false, locked = false, disabled = false, onPress }: TimeChipProps) {
  const { t } = useAppLocale();
  const unavailable = disabled || locked;
  const status = locked ? t('ui.held') : disabled ? t('ui.unavailable') : selected ? t('ui.selected') : undefined;
  return <Control accessibilityRole="button" aria-pressed={selected} accessibilityState={{ selected, disabled: unavailable }} disabled={unavailable} onPress={onPress}
    className={`min-w-24 max-w-full items-center rounded-control border px-4 py-3 ${unavailable ? 'border-control-line bg-canvas' : selected ? 'border-brand bg-brand' : 'border-control-line bg-surface active:border-brand'}`}>
    <Text style={{ textAlign: 'center', writingDirection: 'ltr' }} className={`text-base font-semibold ${selected && !unavailable ? 'text-white' : 'text-ink'}`}>{label}</Text>
    <Text style={{ textAlign: 'center', writingDirection: 'ltr' }} className={`mt-1 text-sm ${selected && !unavailable ? 'text-white' : 'text-muted'}`}>{timezone}</Text>
    {status ? <View className="mt-1"><Text style={{ textAlign: 'center' }} className={`text-sm ${selected && !unavailable ? 'text-white' : 'text-body'}`}>{selected && !unavailable ? '✓ ' : ''}{status}</Text></View> : null}
  </Control>;
}

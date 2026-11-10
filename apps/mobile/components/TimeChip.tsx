import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { Control } from './Control';
const CHECK_WIDTH = 14;
export type TimeChipProps = { label: string; timezone: string; selected?: boolean; locked?: boolean; disabled?: boolean; onPress?: () => void };
export function TimeChip({ label, selected = false, locked = false, disabled = false, onPress }: TimeChipProps) {
  const { t } = useAppLocale();
  const unavailable = disabled || locked;
  // Selection is the colour and a check beside the time, never an extra line: the chip keeps its size, so choosing a
  // time moves nothing around it. The check's room is always kept, mirrored by an equal space before the time so the time stays centred, and screen readers hear "selected" from the state.
  const status = locked ? t('ui.held') : disabled ? t('ui.unavailable') : undefined;
  const chosen = selected && !unavailable;
  return <Control accessibilityRole="button" aria-pressed={selected} accessibilityState={{ selected, disabled: unavailable }} disabled={unavailable} onPress={onPress}
    className={`min-w-24 max-w-full items-center rounded-control border px-4 py-3 ${unavailable ? 'border-control-line bg-canvas' : chosen ? 'border-brand bg-brand' : 'border-control-line bg-surface active:border-brand'}`}>
    <View style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
      <View style={{ width: CHECK_WIDTH }} />
      <Text style={{ textAlign: 'center', writingDirection: 'ltr', flexShrink: 1 }} className={`text-base font-semibold ${chosen ? 'text-white' : 'text-ink'}`}>{label}</Text>
      {chosen ? <Text aria-hidden style={{ width: CHECK_WIDTH }} className="text-base font-semibold text-white">✓</Text> : <View style={{ width: CHECK_WIDTH }} />}
    </View>
    {status ? <View className="mt-1"><Text style={{ textAlign: 'center' }} className="text-sm text-body">{status}</Text></View> : null}
  </Control>;
}

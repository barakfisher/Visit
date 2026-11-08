import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
export type ActiveBookingCardProps = { service: string; provider: string; dateLabel: string; timeLabel: string; onReschedule?: () => void; onCancel?: () => void; actionsPending?: boolean; busy?: boolean; note?: string; error?: string; label?: string; footer?: ReactNode };
export function ActiveBookingCard({ service, provider, dateLabel, timeLabel, onReschedule, onCancel, actionsPending = false, busy = false, note = '', error = '', label = '', footer = null }: ActiveBookingCardProps) {
  const { t } = useAppLocale();
  return <View accessibilityLabel={t('ui.upcoming')} className="gap-4 rounded-card border border-line bg-surface p-card shadow-card">
    <View className="gap-1">
      {label ? <Text className="text-sm font-semibold text-brand">{label}</Text> : null}
      <Text className="text-lg font-semibold text-ink">{service}</Text>
      <Text className="text-sm text-body">{t('ui.provider', { provider })}</Text>
    </View>
    <View className="rounded-control bg-canvas p-3">
      <Text className="font-semibold text-ink">{dateLabel} · {timeLabel}</Text>
    </View>
    {actionsPending ? <View className="flex-row flex-wrap gap-3"><View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={t('home.reschedulePending')} disabled /></View><View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={t('home.cancelPending')} disabled /></View></View> : onReschedule || onCancel ? <View className="flex-row flex-wrap gap-3">
      {onReschedule ? <View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={t('ui.reschedule')} disabled={busy} onPress={onReschedule} /></View> : null}
      {onCancel ? <View style={{ flexGrow: 1, flexBasis: 100 }}><ActionButton secondary label={t('ui.cancel')} busy={busy} onPress={onCancel} /></View> : null}
    </View> : null}
    {note ? <Text className="text-sm text-muted">{note}</Text> : null}
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" className="rounded-control bg-red-50 p-3 text-danger">{error}</Text> : null}
    {footer}
  </View>;
}

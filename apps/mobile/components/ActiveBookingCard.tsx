import { timePolicyNote } from '@/src/lib/appointmentTime';
import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
export type ActiveBookingCardProps = { service: string; provider: string; dateLabel: string; timeLabel: string; timezone: string; onReschedule?: () => void; onCancel?: () => void; actionsPending?: boolean; busy?: boolean };
export function ActiveBookingCard({ service, provider, dateLabel, timeLabel, timezone, onReschedule, onCancel, actionsPending = false, busy = false }: ActiveBookingCardProps) {
  const { t, locale } = useAppLocale();
  return <View accessibilityLabel={t('ui.upcoming')} className="gap-4 rounded-card border border-line bg-surface p-card shadow-card">
    <View className="gap-1">
      <Text className="text-sm font-semibold text-brand">{t('ui.nextVisit')}</Text>
      <Text className="text-lg font-semibold text-ink">{service}</Text>
      <Text className="text-sm text-body">{t('ui.provider', { provider })}</Text>
    </View>
    <View className="rounded-control bg-canvas p-3">
      <Text className="font-semibold text-ink">{dateLabel} · {timeLabel}</Text>
      <Text className="mt-1 text-sm text-muted">{timePolicyNote(timezone, locale)}</Text>
    </View>
    {actionsPending ? <View className="flex-row flex-wrap gap-3"><View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={t('home.reschedulePending')} disabled /></View><View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={t('home.cancelPending')} disabled /></View></View> : onReschedule || onCancel ? <View className="flex-row flex-wrap gap-3">
      {onReschedule ? <View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={t('ui.reschedule')} disabled={busy} onPress={onReschedule} /></View> : null}
      {onCancel ? <View style={{ flexGrow: 1, flexBasis: 100 }}><ActionButton secondary label={t('ui.cancel')} busy={busy} onPress={onCancel} /></View> : null}
    </View> : null}
  </View>;
}

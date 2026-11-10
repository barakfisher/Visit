import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { CalendarIcon, CancelIcon } from './AppointmentActionIcons.component';
export type ActiveBookingCardProps = { service: string; provider: string; dateLabel: string; timeLabel: string; onOpen?: () => void; onReschedule?: () => void; onCancel?: () => void; actionsPending?: boolean; busy?: boolean; note?: string; error?: string; label?: string; footer?: ReactNode };
// The summary is the way into the appointment's details (a link named by what it shows); the actions below it are separate controls, never nested in it.
export function ActiveBookingCard({ service, provider, dateLabel, timeLabel, onOpen, onReschedule, onCancel, actionsPending = false, busy = false, note = '', error = '', label = '', footer = null }: ActiveBookingCardProps) {
  const { t, direction } = useAppLocale();
  const summary = <>
    <View className="gap-1">
      {label ? <Text className="text-sm font-semibold text-brand">{label}</Text> : null}
      <Text className="text-lg font-semibold text-ink">{service}</Text>
      <Text className="text-sm text-body">{t('ui.provider', { provider })}</Text>
    </View>
    <View className="flex-row items-center justify-between gap-3 rounded-control bg-canvas p-3">
      <Text className="shrink font-semibold text-ink">{dateLabel} · {timeLabel}</Text>
      {onOpen ? <Text aria-hidden className="text-xl font-semibold text-brand">{direction === 'rtl' ? '‹' : '›'}</Text> : null}
    </View>
  </>;
  // Two equal halves, so the pair reads as one row of actions whatever the label lengths.
  const half = { flexGrow: 1, flexBasis: 0, minWidth: 110 } as const;
  return <View accessibilityLabel={t('ui.upcoming')} className="gap-4 rounded-card border border-line bg-surface p-card shadow-card">
    {onOpen ? <Control accessibilityRole="link" onPress={onOpen} className="gap-4">{summary}</Control> : <View className="gap-4">{summary}</View>}
    {actionsPending ? <View className="flex-row flex-wrap gap-3"><View style={half}><ActionButton secondary label={t('home.reschedulePending')} disabled /></View><View style={half}><ActionButton secondary label={t('home.cancelPending')} disabled /></View></View> : onReschedule || onCancel ? <View className="flex-row flex-wrap gap-3">
      {onReschedule ? <View style={half}><ActionButton secondary dense label={t('ui.reschedule')} icon={color => <CalendarIcon color={color} />} disabled={busy} onPress={onReschedule} /></View> : null}
      {onCancel ? <View style={half}><ActionButton secondary danger dense label={t('ui.cancel')} icon={color => <CancelIcon color={color} />} busy={busy} onPress={onCancel} /></View> : null}
    </View> : null}
    {note ? <Text className="text-sm text-muted">{note}</Text> : null}
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" className="rounded-control bg-red-50 p-3 text-danger">{error}</Text> : null}
    {footer}
  </View>;
}

import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
import { CardLink } from './CardLink.component';
import { CalendarIcon, CancelIcon } from './AppointmentActionIcons.component';
import { DirectionalChevron } from './DirectionalChevron.component';
import { tokens } from '@/src/design/tokens';
export type ActiveBookingCardProps = { service: string; provider: string; dateLabel: string; timeLabel: string; onOpen?: () => void; onReschedule?: () => void; onCancel?: () => void; actionsPending?: boolean; busy?: boolean; note?: string; error?: string; label?: string };
// The whole card opens the appointment's details; Reschedule and Cancel are separate controls above that link, never inside it.
export function ActiveBookingCard({ service, provider, dateLabel, timeLabel, onOpen, onReschedule, onCancel, actionsPending = false, busy = false, note = '', error = '', label = '' }: ActiveBookingCardProps) {
  const { t } = useAppLocale();
  const providerLine = t('ui.provider', { provider }), when = t('ui.when', { date: dateLabel, time: timeLabel });
  // Two equal halves, so the pair reads as one row of actions whatever the label lengths.
  const half = { flexGrow: 1, flexBasis: 0, minWidth: 110 } as const;
  return <CardLink className="shadow-card" label={[label, service, providerLine, when].filter(Boolean).join(', ')} onPress={onOpen}>
    {/* The date reads as part of the description, not as a control; the chevron by the title says the card opens. */}
    <CardLink.Passive hidden={Boolean(onOpen)} className="gap-1">
      {label ? <Text className="text-sm font-semibold text-brand">{label}</Text> : null}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="shrink text-lg font-semibold text-ink">{service}</Text>
        {onOpen ? <DirectionalChevron pointing="forward" color={tokens.color.muted} /> : null}
      </View>
      <Text className="text-sm text-body">{providerLine}</Text>
      <Text className="text-sm text-body">{when}</Text>
    </CardLink.Passive>
    {actionsPending ? <View className="flex-row flex-wrap gap-3"><View style={half}><ActionButton secondary label={t('home.reschedulePending')} disabled /></View><View style={half}><ActionButton secondary label={t('home.cancelPending')} disabled /></View></View> : onReschedule || onCancel ? <View className="flex-row flex-wrap gap-3">
      {onReschedule ? <View style={half}><ActionButton secondary dense label={t('ui.reschedule')} icon={color => <CalendarIcon color={color} />} disabled={busy} onPress={onReschedule} /></View> : null}
      {onCancel ? <View style={half}><ActionButton secondary danger dense label={t('ui.cancel')} icon={color => <CancelIcon color={color} />} busy={busy} onPress={onCancel} /></View> : null}
    </View> : null}
    {note ? <CardLink.Passive><Text className="text-sm text-muted">{note}</Text></CardLink.Passive> : null}
    {error ? <CardLink.Passive><Text accessibilityRole="alert" accessibilityLiveRegion="assertive" className="rounded-control bg-red-50 p-3 text-danger">{error}</Text></CardLink.Passive> : null}
  </CardLink>;
}

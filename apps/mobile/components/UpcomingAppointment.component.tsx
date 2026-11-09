import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';
import type { UpcomingAppointmentView } from '../src/types/UpcomingAppointment.types';
/** A glance at the appointments ahead; each card opens its own details, where cancelling and rescheduling live. */
export function UpcomingAppointment(view: UpcomingAppointmentView) {
  if (view.state === 'hidden') return null;
  if (view.state === 'loading') return <AppText role="status">{view.loadingLabel}</AppText>;
  if (view.state === 'error') return <View className="gap-3"><AppText accessibilityRole="alert">{view.error}</AppText><ActionButton secondary label={view.retryLabel} onPress={view.onRetry} /></View>;
  if (!view.appointments.length) return null;
  return <View className="gap-2">
    {view.heading ? <AppText accessibilityRole="header" className={view.sectionHeading ? 'text-xl font-bold text-ink' : 'text-sm font-semibold text-brand'}>{view.heading}</AppText> : null}
    {view.appointments.map(appointment => <Control key={appointment.id} testID={`active-booking-${appointment.id}`} accessibilityRole="button" onPress={() => view.onOpen(appointment.id)} className="flex-row items-center gap-3 rounded-card border border-line bg-surface px-4 py-2 active:bg-brand-soft">
      <View className="flex-1">
        <AppText className="font-semibold text-ink">{appointment.when}</AppText>
        <AppText className="text-sm text-body">{appointment.place}</AppText>
      </View>
      <DirectionalChevron pointing="forward" color={tokens.color.muted} />
    </Control>)}
  </View>;
}

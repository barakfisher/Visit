import { View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import type { UpcomingAppointmentView } from '../src/types/UpcomingAppointment.types';
export function UpcomingAppointment(view: UpcomingAppointmentView) {
  if (view.state === 'hidden') return null;
  if (view.state === 'loading') return <AppText accessibilityRole="status">{view.loadingLabel}</AppText>;
  if (view.state === 'error') return <View className="gap-3"><AppText accessibilityRole="alert">{view.error}</AppText><ActionButton secondary label={view.retryLabel} onPress={view.onRetry} /></View>;
  const appointment = view.appointment;
  if (!appointment) return null;
  return <View testID={`active-booking-${appointment.id}`} className="gap-3 rounded-card border border-line bg-surface p-4">
    <AppText accessibilityRole="header" className="text-sm font-semibold text-brand">{view.heading}</AppText>
    <AppText className="text-lg font-semibold text-ink">{appointment.service}</AppText>
    <AppText>{appointment.business} · {appointment.staff}</AppText>
    <AppText className="font-semibold">{appointment.when}</AppText>
    <AppText className="text-sm text-muted">{appointment.timeNote}</AppText>
    <ActionButton secondary label={view.detailsLabel} onPress={view.onDetails} disabled={view.busy} />
    <View className="flex-row flex-wrap gap-3">
      {appointment.canReschedule ? <View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={view.rescheduleLabel} onPress={view.onReschedule} disabled={view.busy} /></View> : null}
      {appointment.canCancel ? <View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton secondary label={view.cancelLabel} onPress={view.onCancel} busy={view.busy} /></View> : null}
    </View>
    {view.error ? <View className="gap-2"><AppText accessibilityRole="alert">{view.error}</AppText><ActionButton secondary label={view.retryLabel} onPress={view.onRetry} disabled={view.busy} /></View> : null}
    {view.additionalLabel ? <ActionButton secondary label={view.additionalLabel} onPress={view.onAll} disabled={view.busy} /> : null}
  </View>;
}

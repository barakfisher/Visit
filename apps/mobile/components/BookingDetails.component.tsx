import { ActivityIndicator, ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import type { BookingDetailsView } from '@/src/types/BookingDetails.types';
export function BookingDetails(view: BookingDetailsView) {
  const booking = view.booking;
  return <ScrollView testID="booking-confirmation" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-8 md:px-8">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{view.heading}</AppText>
    {view.subtitle ? <AppText>{view.subtitle}</AppText> : null}
    {view.loading ? <View className="flex-row gap-2"><ActivityIndicator accessibilityLabel={view.loadingLabel} /><AppText>{view.loadingLabel}</AppText></View> : null}
    {view.needsSignIn ? <ActionButton secondary label={view.signInLabel} onPress={view.onSignIn} /> : null}
    {view.error ? <View className="gap-3"><AppText accessibilityRole="alert" className="text-danger">{view.error}</AppText><ActionButton secondary label={view.retryLabel} onPress={view.onRetry} /></View> : null}
    {booking ? <View className="gap-4 rounded-card border border-line bg-surface p-5"><AppText className="text-xl font-semibold text-ink">{booking.service.name}</AppText><AppText>{booking.business.name} · {booking.staff.displayName}</AppText><AppText className="font-semibold text-brand">{view.when}</AppText><AppText>{view.status}</AppText><AppText>{view.durationAndPrice}</AppText><AppText className="text-sm text-muted">{view.timeNote}</AppText><AppText>{view.cancellation}</AppText>
      {booking.actions.canExport ? <ActionButton secondary label={view.exportLabel} busy={view.exporting} disabled={view.busy} onPress={view.onExport} /> : null}
      {view.exportError ? <AppText accessibilityRole="alert" className="text-danger">{view.exportError}</AppText> : null}
      {booking.actions.canReschedule ? <ActionButton secondary label={view.rescheduleLabel} onPress={view.onReschedule} /> : null}
      {booking.actions.canCancel ? <ActionButton secondary label={view.cancelLabel} busy={view.busy} disabled={view.exporting} onPress={view.onCancel} /> : null}
      {!view.detailsMode ? <ActionButton secondary label={view.detailsLabel} onPress={view.onDetails} /> : null}
      <AppText>{view.notificationNote}</AppText><ActionButton secondary disabled label={view.unsupportedSms} /><ActionButton secondary disabled label={view.unsupportedWhatsapp} />
    </View> : null}
    <ActionButton secondary label={view.historyLabel} onPress={view.onHistory} /><ActionButton secondary label={view.homeLabel} onPress={view.onHome} />
  </ScrollView>;
}

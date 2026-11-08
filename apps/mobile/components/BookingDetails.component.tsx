import { ActivityIndicator, ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { BackButton } from './BackButton.component';
import { CalendarIcon, SmsIcon, WhatsappIcon } from './AppointmentActionIcons.component';
import { IconButton } from './IconButton.component';
import type { BookingDetailsView } from '@/src/types/BookingDetails.types';
export function BookingDetails(view: BookingDetailsView) {
  const booking = view.booking;
  return <ScrollView testID="booking-confirmation" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-4 px-5 py-3 md:px-8">
    <BackButton label={view.backLabel} onPress={view.onBack} />
    {view.loading ? <View className="flex-row gap-2"><ActivityIndicator accessibilityLabel={view.loadingLabel} /><AppText>{view.loadingLabel}</AppText></View> : null}
    {view.needsSignIn ? <ActionButton secondary label={view.signInLabel} onPress={view.onSignIn} /> : null}
    {view.error ? <View className="gap-3"><AppText accessibilityRole="alert" className="text-danger">{view.error}</AppText><ActionButton secondary label={view.retryLabel} onPress={view.onRetry} /></View> : null}
    {booking ? <View className="gap-4 rounded-card border border-line bg-surface p-5">
      <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{booking.service.name}</AppText>
      <AppText>{booking.business.name} · {booking.staff.displayName}</AppText>
      {view.address ? <AppText>{view.address}</AppText> : null}
      <AppText className="font-semibold text-brand">{view.when}</AppText>
      {view.status ? <AppText>{view.status}</AppText> : null}
      <AppText>{view.durationAndPrice}</AppText>
      {view.cancellation ? <AppText>{view.cancellation}</AppText> : null}
      {booking.actions.canExport || view.notificationNote ? <View className="flex-row gap-3">
        {booking.actions.canExport ? <IconButton label={view.exportLabel} busy={view.exporting} disabled={view.busy} onPress={view.onExport}>{color => <CalendarIcon color={color} />}</IconButton> : null}
        {view.notificationNote ? <><IconButton disabled label={view.unsupportedSms}>{color => <SmsIcon color={color} />}</IconButton><IconButton disabled label={view.unsupportedWhatsapp}>{color => <WhatsappIcon color={color} />}</IconButton></> : null}
      </View> : null}
      {view.exportError ? <AppText accessibilityRole="alert" className="text-danger">{view.exportError}</AppText> : null}
      {view.notificationNote ? <AppText className="text-sm text-muted">{view.notificationNote}</AppText> : null}
      {booking.actions.canReschedule ? <ActionButton secondary label={view.rescheduleLabel} disabled={view.busy} onPress={view.onReschedule} /> : null}
      {booking.actions.canCancel ? <ActionButton secondary label={view.cancelLabel} busy={view.busy} disabled={view.exporting} onPress={view.onCancel} /> : null}
    </View> : null}
  </ScrollView>;
}

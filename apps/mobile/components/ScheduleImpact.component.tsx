import { View } from 'react-native';
import type { WeeklyHoursState } from '@/src/lib/WeeklyHours.hook';
import { AppText } from './AppText';

/** Appointments and reservations that a refused hours change would have left outside working hours. */
export function ScheduleImpact({ t, preview, when }: Pick<WeeklyHoursState, 't' | 'preview' | 'when'>) {
  if (!preview) return null;
  return <View testID="schedule-impact" className="gap-3 rounded-card border border-line bg-canvas p-4">
    <AppText accessibilityRole="alert" className="text-danger">{t('hours.conflicts', { count: preview.affected.length })}</AppText>
    <AppText className="text-sm text-muted">{t('agendaEdit.buffers')}</AppText>
    {preview.affected.map(booking => <View key={booking.id} className="gap-1">
      <AppText className="font-semibold">{booking.serviceName} · {booking.staffName}</AppText>
      <AppText>{when(booking.startsAt)}</AppText>
      <AppText>{t(booking.status === 'HELD' ? 'agendaEdit.reservation' : 'agendaEdit.appointment')}</AppText>
    </View>)}
  </View>;
}

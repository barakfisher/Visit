import { View } from 'react-native';
import { AppText } from './AppText';
import { TextField } from './TextField';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import type { ScheduleEditorView } from '../src/types/ScheduleEditor.types';
export function ScheduleEditor(view: ScheduleEditorView) {
  const { t, locale, staff, weekly, overrides, busy, feedback, interval, exception } = view;
  if (!view.ready) return <View className="gap-3"><AppText accessibilityRole={view.failed ? 'alert' : 'status'}>{t(view.failed ? 'setup.failure' : 'common.loading')}</AppText>{view.failed ? <ActionButton label={t('common.retry')} onPress={view.reload} /> : null}</View>;
  return <View className="gap-4">
    {view.failed ? <View className="gap-2"><AppText accessibilityRole="alert">{t('setup.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={view.reload} disabled={busy} /></View> : null}
    <AppText accessibilityRole="header" className="text-lg font-semibold">{t('setup.weekly')}</AppText><AppText>{t(staff ? 'setup.inheritHint' : 'setup.hoursHint')}</AppText>
    {staff ? <ActionButton secondary label={t('setup.inherit')} onPress={view.inherit} disabled={busy} /> : null}
    {weekly.map((hours, day) => {
      const label = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + day)));
      return <View key={day} className="gap-3 rounded-control border border-line p-4"><AppText className="font-semibold">{label}</AppText>
        {hours.map((h, index) => <View key={index} className="gap-3"><TextField editable={!busy} label={t('setup.opening', { day: label, index: index + 1 })} identifier value={h.startLocal} onChangeText={startLocal => interval(day, index, { startLocal })} /><TextField editable={!busy} label={t('setup.closing', { day: label, index: index + 1 })} identifier value={h.endLocal} onChangeText={endLocal => interval(day, index, { endLocal })} /><ActionButton secondary label={t('setup.removeHours', { day: label, index: index + 1 })} onPress={() => interval(day, index)} disabled={busy} /></View>)}
        <ActionButton secondary label={t('setup.addHours', { day: label })} onPress={() => view.addHours(day)} disabled={busy} />
      </View>;
    })}
    <AppText accessibilityRole="header" className="text-lg font-semibold">{t('setup.exceptions')}</AppText>
    {overrides.map((e, index) => <View key={index} className="gap-3 rounded-control border border-line p-4">
      <TextField editable={!busy} label={t('setup.exceptionDate', { index: index + 1 })} identifier value={e.date} onChangeText={date => exception(index, { date })} />
      <Control disabled={busy} accessibilityRole="checkbox" accessibilityState={{ checked: e.isOpen }} onPress={() => exception(index, { isOpen: !e.isOpen })} className="justify-center rounded-control border border-line p-3"><AppText>{e.isOpen ? '✓ ' : ''}{t('setup.exceptionOpen', { index: index + 1 })}</AppText></Control>
      {e.isOpen ? <><TextField editable={!busy} identifier label={t('setup.exceptionStart', { index: index + 1 })} value={e.startLocal ?? ''} onChangeText={startLocal => exception(index, { startLocal })} /><TextField editable={!busy} identifier label={t('setup.exceptionEnd', { index: index + 1 })} value={e.endLocal ?? ''} onChangeText={endLocal => exception(index, { endLocal })} /></> : null}
      <ActionButton secondary label={t('setup.removeException', { index: index + 1 })} onPress={() => view.removeException(index)} disabled={busy} />
    </View>)}
    <ActionButton secondary label={t('setup.addException')} onPress={view.addException} disabled={busy} />
    <ActionButton label={t('setup.saveHours')} busy={busy} onPress={view.save} />
    {view.preview ? <View testID="schedule-impact" className="gap-3 rounded-card border border-line bg-surface p-4"><AppText accessibilityRole="header" className="font-semibold">{t('agendaEdit.previewTitle')}</AppText><AppText accessibilityRole={view.preview.canSave ? 'status' : 'alert'}>{t(view.preview.canSave ? 'agendaEdit.safe' : 'agendaEdit.conflicts', { count: view.preview.affected.length })}</AppText>
      <AppText className="text-sm text-muted">{t('agendaEdit.buffers')}</AppText>
      {view.preview.affected.map(booking => <View key={booking.id} className="gap-1"><AppText>{booking.serviceName} · {booking.staffName}</AppText><AppText>{view.when(booking.startsAt)}</AppText><AppText>{t(booking.status === 'HELD' ? 'agendaEdit.reservation' : 'agendaEdit.appointment')}</AppText></View>)}
      <ActionButton label={t('agendaEdit.confirm')} disabled={!view.preview.canSave || view.preview.affected.length > 0} busy={busy} onPress={view.confirm} />
    </View> : null}
    <ActionButton secondary label={t('setup.reload')} onPress={view.reload} disabled={busy} />
    {feedback ? <AppText accessibilityRole={feedback === 'error' ? 'alert' : 'status'}>{t(feedback === 'error' ? 'agendaEdit.saveFailure' : 'setup.saved')}</AppText> : null}
  </View>;
}

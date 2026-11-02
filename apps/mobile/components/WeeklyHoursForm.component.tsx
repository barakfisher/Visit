import { Switch, View } from 'react-native';
import type { MessageKey } from '@/src/i18n/messages';
import { WEEKDAYS, type HoursFormError } from '@/src/lib/WeeklyHours';
import type { WeeklyHoursState } from '@/src/lib/WeeklyHours.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { AddButton } from './AddButton';
import { Control } from './Control';
import { ScheduleImpact } from './ScheduleImpact.component';
import { TextField } from './TextField';

const errorMessages: Record<HoursFormError, MessageKey> = { days: 'hours.error.days', format: 'hours.error.format', order: 'hours.error.order', overlap: 'hours.error.overlap', staffClosed: 'hours.error.staffClosed' };
const dayName = (locale: string, day: number) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + day)));

/** The edit dialog's form: choose days, then their hours or "closed". Saving here is the only save. */
export function WeeklyHoursForm(state: WeeklyHoursState) {
  const { t, locale, form, errors, busy, failure, canAddInterval, toggleDay, setClosed, setInterval, addInterval, removeInterval, save, cancelForm } = state;
  const errorFor = (key: string) => errors[key] ? t(errorMessages[errors[key]!]) : undefined;
  return <View testID="hours-form" className="gap-4">
    <View className="gap-2">
      <AppText className="font-medium text-ink">{t('hours.days')}</AppText>
      {/* One row of seven: flex-1 chips stay at least 44pt wide on a 375pt phone. */}
      <View className="flex-row gap-1">
        {WEEKDAYS.map(day => {
          const checked = form.days.includes(day);
          return <Control key={day} disabled={busy} accessibilityRole="checkbox" aria-checked={checked} accessibilityLabel={dayName(locale, day)} accessibilityState={{ checked, disabled: busy }} onPress={() => toggleDay(day)}
            className={`min-h-touch flex-1 items-center justify-center rounded-control border py-3 ${checked ? 'border-brand bg-brand-soft' : 'border-line'}`}>
            <AppText className={checked ? 'font-semibold text-brand' : 'text-ink'}>{t(`hours.day.${day}`)}</AppText>
          </Control>;
        })}
      </View>
      {errorFor('days') ? <AppText accessibilityRole="alert" className="text-sm text-danger">{errorFor('days')}</AppText> : <AppText className="text-sm text-body">{t('hours.daysHint')}</AppText>}
    </View>
    <View className="flex-row items-center justify-between gap-3">
      <AppText className="flex-1 font-medium text-ink">{t('hours.closedSwitch')}</AppText>
      <Switch accessibilityLabel={t('hours.closedSwitch')} disabled={busy} value={form.closed} onValueChange={setClosed} />
    </View>
    {form.closed ? null : <View className="gap-3">
      {form.intervals.map((row, index) => <View key={index} className="gap-2">
        <View className="flex-row gap-3">
          <View className="flex-1"><TextField identifier editable={!busy} label={t('hours.opening', { index: index + 1 })} value={row.startLocal} placeholder="09:00" maxLength={5} onChangeText={startLocal => setInterval(index, { startLocal })} error={errorFor(`start.${index}`)} /></View>
          <View className="flex-1"><TextField identifier editable={!busy} label={t('hours.closing', { index: index + 1 })} value={row.endLocal} placeholder="17:00" maxLength={5} onChangeText={endLocal => setInterval(index, { endLocal })} error={errorFor(`end.${index}`)} /></View>
        </View>
        {form.intervals.length > 1 ? <Control accessibilityRole="button" accessibilityLabel={t('hours.removeInterval', { index: index + 1 })} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => removeInterval(index)} className="min-h-touch self-start justify-center">
          <AppText className={`font-semibold ${busy ? 'text-muted' : 'text-brand'}`}>{t('hours.removeInterval', { index: index + 1 })}</AppText>
        </Control> : null}
      </View>)}
      {canAddInterval ? <View className="self-start"><AddButton testID="hours-add-interval" label={t('hours.addInterval')} disabled={busy} onPress={addInterval} /></View> : null}
      <AppText className="text-sm text-body">{t('hours.timeHint')}</AppText>
    </View>}
    {errorFor('form') ? <AppText accessibilityRole="alert" className="text-danger">{errorFor('form')}</AppText> : null}
    <ScheduleImpact {...state} />
    {failure ? <AppText accessibilityRole="alert" className="text-danger">{t(failure)}</AppText> : null}
    <View className="flex-row gap-3">
      <View className="flex-1"><ActionButton label={t('hours.save')} busy={busy} onPress={save} /></View>
      <View className="flex-1"><ActionButton secondary disabled={busy} label={t('hours.cancel')} onPress={cancelForm} /></View>
    </View>
  </View>;
}

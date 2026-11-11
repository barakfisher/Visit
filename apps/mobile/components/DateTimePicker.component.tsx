import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { intlLocale } from '@/src/lib/appointmentTime';
import { bookingMonthCells, shiftBookingMonth, validBookingDate } from '@/src/lib/CompactBooking.utils';
import { pickableDays, pickTime, timeParts, TIME_PICKER_HOURS, TIME_PICKER_MINUTES } from '@/src/lib/DateTimePicker';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { FormDialog } from './FormDialog';
import { MonthStep } from './MonthStep.component';
import { CALENDAR_MIN_WIDTH, compactBookingStyles as styles } from './CompactBookingControls.styles';

type FieldProps = { label: string; value: string; error?: string; disabled?: boolean; testID?: string };

/** The closed field: its label, the chosen value, and a tap that opens the picker. Nothing is typed (decisions.md, 2026-11-11). */
function Trigger({ label, shown, error, disabled, testID, onPress }: { label: string; shown: string; error?: string; disabled?: boolean; testID?: string; onPress: () => void }) {
  return <View className="gap-2" style={{ minWidth: 0 }}>
    <AppText className="font-medium text-ink">{label}</AppText>
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label} · ${shown}`} accessibilityHint={error} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={{ minHeight: tokens.layout.minTouchTarget, borderWidth: error ? 2 : 1, borderColor: error ? tokens.color.danger : tokens.color.controlLine, backgroundColor: disabled ? tokens.color.canvas : tokens.color.surface }}
      className="justify-center rounded-control px-4 py-2.5 active:bg-brand-soft">
      <AppText className="text-base text-ink">{shown}</AppText>
    </Pressable>
    {error ? <AppText accessibilityRole="alert" style={{ color: tokens.color.danger, fontSize: tokens.typography.caption }}>{error}</AppText> : null}
  </View>;
}

/** A date chosen from a month grid; days before `min` (and after `max`, when given) cannot be chosen. */
export function DatePickerField({ label, value, error, disabled, testID, min, max = '', onChange }: FieldProps & { min: string; max?: string; onChange: (date: string) => void }) {
  const { t, locale } = useAppLocale(), language = intlLocale(locale);
  const [open, setOpen] = useState(false), [month, setMonth] = useState((validBookingDate(value) ? value : min).slice(0, 7));
  const [width, setWidth] = useState(0);
  const shown = validBookingDate(value) ? new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${value}T12:00Z`)) : t('picker.empty');
  const monthTitle = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00Z`));
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + index, 12))));
  const cells = bookingMonthCells(month, pickableDays(month, min, max), value, language);
  function show() { setMonth((validBookingDate(value) ? value : min).slice(0, 7)); setOpen(true); }
  return <>
    <Trigger label={label} shown={shown} error={error} disabled={disabled} testID={testID} onPress={show} />
    <FormDialog testID={testID ? `${testID}-sheet` : undefined} title={label} open={open} onClose={() => setOpen(false)}>
      <View className="flex-row items-center gap-2">
        <MonthStep pointing="back" label={t('picker.previousMonth')} disabled={month <= min.slice(0, 7)} onPress={() => setMonth(shiftBookingMonth(month, -1))} />
        <AppText style={{ textAlign: 'center' }} className="flex-1 font-semibold text-ink">{monthTitle}</AppText>
        <MonthStep pointing="forward" label={t('picker.nextMonth')} disabled={Boolean(max) && month >= max.slice(0, 7)} onPress={() => setMonth(shiftBookingMonth(month, 1))} />
      </View>
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)}><ScrollView horizontal accessibilityLabel={monthTitle}><View style={{ width: Math.max(width, CALENDAR_MIN_WIDTH) }}>
        <View className="flex-row">{weekdays.map((day, index) => <AppText key={index} style={styles.weekday} className="text-xs text-muted">{day}</AppText>)}</View>
        <View className="flex-row flex-wrap">{cells.map((cell, index) => <View key={cell?.date ?? `blank-${index}`} style={styles.cell}>{cell ? <Pressable testID={testID ? `${testID}-day-${cell.date}` : undefined} accessibilityRole="button" accessibilityLabel={cell.label} accessibilityState={{ disabled: !cell.available, selected: cell.selected }} aria-pressed={cell.selected} disabled={!cell.available} onPress={() => { onChange(cell.date); setOpen(false); }}
          className={`min-h-11 items-center justify-center rounded-control border ${!cell.available ? 'border-transparent bg-canvas' : cell.selected ? 'border-brand bg-brand' : 'border-line bg-surface'}`}>
          <AppText className={!cell.available ? 'text-muted' : cell.selected ? 'font-semibold text-white' : 'font-semibold text-ink'}>{cell.day}</AppText>
        </Pressable> : <View style={styles.blank} />}</View>)}</View>
      </View></ScrollView></View>
    </FormDialog>
  </>;
}

function Choice({ label, selected, testID, onPress }: { label: string; selected: boolean; testID?: string; onPress: () => void }) {
  return <Pressable testID={testID} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ checked: selected }} onPress={onPress} style={{ width: '16.6667%', padding: 2 }}>
    <View className={`min-h-11 items-center justify-center rounded-control border ${selected ? 'border-brand bg-brand' : 'border-line bg-surface'}`}>
      <AppText style={{ writingDirection: 'ltr' }} className={selected ? 'font-semibold text-white' : 'text-ink'}>{label}</AppText>
    </View>
  </Pressable>;
}

/** A 24-hour time chosen as an hour and then minutes, in steps of TIME_PICKER_MINUTE_STEP. */
export function TimePickerField({ label, value, error, disabled, testID, onChange }: FieldProps & { onChange: (time: string) => void }) {
  const { t } = useAppLocale();
  const [open, setOpen] = useState(false);
  const { hour, minute } = timeParts(value);
  return <>
    <Trigger label={label} shown={hour ? value : t('picker.empty')} error={error} disabled={disabled} testID={testID} onPress={() => setOpen(true)} />
    <FormDialog testID={testID ? `${testID}-sheet` : undefined} title={label} open={open} onClose={() => setOpen(false)}>
      <AppText style={{ writingDirection: 'ltr', textAlign: 'center' }} className="text-3xl font-bold text-ink">{hour ? value : '--:--'}</AppText>
      <View className="gap-1" accessibilityRole="radiogroup" accessibilityLabel={t('picker.hour')}>
        <AppText className="text-sm font-semibold text-body">{t('picker.hour')}</AppText>
        {/* Hours read left to right in both languages, like a clock. */}
        <View className="flex-row flex-wrap" style={{ direction: 'ltr' }}>{TIME_PICKER_HOURS.map(item => <Choice key={item} testID={testID ? `${testID}-hour-${item}` : undefined} label={item} selected={item === hour} onPress={() => onChange(pickTime(value, { hour: item }))} />)}</View>
      </View>
      <View className="gap-1" accessibilityRole="radiogroup" accessibilityLabel={t('picker.minute')}>
        <AppText className="text-sm font-semibold text-body">{t('picker.minute')}</AppText>
        <View className="flex-row flex-wrap" style={{ direction: 'ltr' }}>{TIME_PICKER_MINUTES.map(item => <Choice key={item} testID={testID ? `${testID}-minute-${item}` : undefined} label={item} selected={item === minute} onPress={() => onChange(pickTime(value, { minute: item }))} />)}</View>
      </View>
      <ActionButton testID={testID ? `${testID}-done` : undefined} label={t('picker.done')} onPress={() => setOpen(false)} />
    </FormDialog>
  </>;
}

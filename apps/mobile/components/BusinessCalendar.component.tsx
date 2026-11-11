import { ScrollView, View } from 'react-native';
import type { BusinessCalendarView } from '@/src/types/BusinessCalendar.types';
import { ActionButton } from './ActionButton';
import { AgendaAppointmentCard } from './AgendaAppointmentCard.component';
import { AppointmentAudit } from './AppointmentAudit.component';
import { AppText as Text } from './AppText';
import { CalendarAllDayRow, CalendarDayHeaders, CalendarTimeGrid } from './CalendarGrid.component';
import { Control } from './Control';
import { FormDialog } from './FormDialog';
import { ManualBookingDialog } from './ManualBooking.component';
import { MonthStep } from './MonthStep.component';
import { TimeBlockRow } from './TimeBlocks';

/** The period's month and dates, the arrows, Today and the week/day switch. */
export function CalendarHeader(view: Pick<BusinessCalendarView, 't' | 'mode' | 'setMode' | 'monthTitle' | 'rangeTitle' | 'previous' | 'next' | 'goToday' | 'showsToday'>) {
  const { t, mode } = view;
  return <View className="gap-2 border-b border-line bg-surface px-4 pb-3 pt-4">
    <View className="flex-row items-center gap-3">
      <Text testID="calendar-month" accessibilityRole="header" className="flex-1 text-2xl font-bold text-ink">{view.monthTitle}</Text>
      {view.showsToday ? null : <View><ActionButton secondary testID="calendar-today" label={t('calendar.today')} onPress={view.goToday} /></View>}
    </View>
    <View className="flex-row items-center gap-2">
      <MonthStep pointing="back" label={t(mode === 'week' ? 'calendar.previousWeek' : 'calendar.previousDay')} disabled={false} onPress={view.previous} />
      <Text testID="calendar-range" style={{ textAlign: 'center' }} className="flex-1 font-semibold text-body">{view.rangeTitle}</Text>
      <MonthStep pointing="forward" label={t(mode === 'week' ? 'calendar.nextWeek' : 'calendar.nextDay')} disabled={false} onPress={view.next} />
    </View>
    <View accessibilityLabel={t('calendar.mode')} className="flex-row rounded-control border border-line bg-canvas p-1">
      {(['week', 'day'] as const).map(option => <Control key={option} testID={`calendar-mode-${option}`} accessibilityRole="button" accessibilityState={{ selected: mode === option }} aria-pressed={mode === option}
        onPress={() => view.setMode(option)} className={`flex-1 items-center justify-center rounded-control ${mode === option ? 'bg-brand' : 'active:bg-brand-soft'}`}>
        <Text className={`font-semibold ${mode === option ? 'text-white' : 'text-body'}`}>{t(`calendar.${option}`)}</Text>
      </Control>)}
    </View>
  </View>;
}

/**
 * The business calendar (decisions.md, "The calendar screen" — 2026-11-11): a week or a day of appointments and blocks
 * on the business's hours. A day opens the day view; an appointment or a block opens its sheet; an empty slot ahead
 * opens Add appointment at that time.
 */
export function BusinessCalendar(view: BusinessCalendarView) {
  const { t, status, mode, columns } = view;
  const closedDay = mode === 'day' && status === 'ready' && !columns[0]?.hours?.windows.length;
  const booking = view.openAppointment, block = view.openBlock;
  return <View className="flex-1 bg-canvas">
    <View className="mx-auto w-full flex-1" style={{ maxWidth: 960 }}>
      <CalendarHeader {...view} />
      {status === 'error' ? <View className="gap-2 p-4"><Text accessibilityRole="alert">{t('calendar.loadFailure')}</Text><ActionButton secondary label={t('common.retry')} onPress={view.retry} /></View>
        : status === 'loading' ? <Text role="status" className="p-4 text-body">{t('calendar.loading')}</Text>
        : <>
          {closedDay ? <Text testID="calendar-closed" className="px-4 pt-2 text-sm text-muted">{t('calendar.closedDay')}</Text>
            : view.empty ? <Text testID="calendar-empty" className="px-4 pt-2 text-sm text-muted">{t(mode === 'week' ? 'calendar.emptyWeek' : 'calendar.emptyDay')}</Text> : null}
          {view.feedback ? <Text accessibilityRole="alert" className="px-4 pt-2 text-danger">{view.feedback}</Text> : null}
          <CalendarDayHeaders {...view} />
          <CalendarAllDayRow {...view} />
          <ScrollView className="flex-1" contentContainerClassName="pb-10 pt-2"><CalendarTimeGrid {...view} /></ScrollView>
        </>}
    </View>
    <ManualBookingDialog {...view.manual} />
    {/* Until the appointment screen exists, a tapped appointment opens the home's card, unfolded, in a sheet. */}
    <FormDialog testID="calendar-appointment" title={t('calendar.appointmentTitle')} open={booking !== null} onClose={view.closeEntry}>
      {booking ? <AgendaAppointmentCard key={booking.id} initiallyOpen booking={booking} span={view.span(booking.startsAt, booking.endsAt)} t={t} contact={view.contact}
        lifecycle={<AppointmentAudit key={`${view.businessId}:${booking.id}`} booking={booking} timezone={view.timezone} businessId={view.businessId} quiet />} /> : null}
    </FormDialog>
    {/* A block's details and its release, as on the home. */}
    <FormDialog testID="calendar-block" title={t('dashboard.blockTitle')} open={block !== null} onClose={view.closeEntry}>
      {block ? <TimeBlockRow block={block} t={t} locale={view.locale} {...view.blockRemoval} /> : null}
    </FormDialog>
  </View>;
}

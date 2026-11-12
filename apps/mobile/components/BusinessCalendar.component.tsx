import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { tokens } from '@/src/design/tokens';
import { CALENDAR_MODES, type CalendarMode } from '@/src/lib/CalendarGrid';
import type { BusinessCalendarView } from '@/src/types/BusinessCalendar.types';
import { ActionButton } from './ActionButton';
import { AgendaAppointmentCard } from './AgendaAppointmentCard.component';
import { AppointmentAudit } from './AppointmentAudit.component';
import { AppText as Text } from './AppText';
import { CalendarDayHeaders, CalendarTimeGrid } from './CalendarGrid.component';
import { Control } from './Control';
import { FormDialog } from './FormDialog';
import { ManualBookingDialog } from './ManualBooking.component';
import { MonthStep } from './MonthStep.component';
import { TimeBlockDialog } from './TimeBlockForm.component';
import { TimeBlockRow } from './TimeBlocks';

const stepLabels: Record<CalendarMode, readonly ['calendar.previousWeek' | 'calendar.previousThreeDays' | 'calendar.previousDay', 'calendar.nextWeek' | 'calendar.nextThreeDays' | 'calendar.nextDay']> = {
  week: ['calendar.previousWeek', 'calendar.nextWeek'], threeDays: ['calendar.previousThreeDays', 'calendar.nextThreeDays'], day: ['calendar.previousDay', 'calendar.nextDay'],
};
/** A drag must move this far sideways to be a swipe, and fails once it moves this far up or down first, so the grid still scrolls. */
const SWIPE_START = 20;
const SWIPE_FAIL_VERTICAL = 14;
/** The grid follows the finger at this fraction of the drag: enough to feel it move, not so much it looks like a page. */
const SWIPE_FOLLOW = 0.4;

/** The period's month and dates, the arrows, Today and the week / three days / day switch. */
export function CalendarHeader(view: Pick<BusinessCalendarView, 't' | 'mode' | 'setMode' | 'monthTitle' | 'rangeTitle' | 'previous' | 'next' | 'goToday' | 'showsToday'>) {
  const { t, mode } = view;
  return <View className="gap-2 border-b border-line bg-surface px-4 pb-3 pt-4">
    <View className="flex-row items-center gap-3">
      <Text testID="calendar-month" accessibilityRole="header" className="flex-1 text-2xl font-bold text-ink">{view.monthTitle}</Text>
      {view.showsToday ? null : <View><ActionButton secondary testID="calendar-today" label={t('calendar.today')} onPress={view.goToday} /></View>}
    </View>
    <View className="flex-row items-center gap-2">
      <MonthStep pointing="back" label={t(stepLabels[mode][0])} disabled={false} onPress={view.previous} />
      <Text testID="calendar-range" style={{ textAlign: 'center' }} className="flex-1 font-semibold text-body">{view.rangeTitle}</Text>
      <MonthStep pointing="forward" label={t(stepLabels[mode][1])} disabled={false} onPress={view.next} />
    </View>
    <View accessibilityLabel={t('calendar.mode')} className="flex-row rounded-control border border-line bg-canvas p-1">
      {CALENDAR_MODES.map(option => <Control key={option} testID={`calendar-mode-${option}`} accessibilityRole="button" accessibilityState={{ selected: mode === option }} aria-pressed={mode === option}
        onPress={() => view.setMode(option)} className={`flex-1 items-center justify-center rounded-control ${mode === option ? 'bg-brand' : 'active:bg-brand-soft'}`}>
        <Text className={`font-semibold ${mode === option ? 'text-white' : 'text-body'}`}>{t(`calendar.${option}`)}</Text>
      </Control>)}
    </View>
  </View>;
}

/**
 * A sideways swipe over the days moves to the next or previous period (decisions.md, "Calendar: three days, swipe,
 * whole-day blocks, slot choices"). Gesture Handler, as in `FormDialog`, so the vertical scroll keeps its own touches;
 * on web the browser keeps vertical panning (`touchAction`).
 */
function Swipeable({ swipe, children }: Pick<BusinessCalendarView, 'swipe'> & { children: ReactNode }) {
  const drag = useSharedValue(0);
  const gesture = usePanGesture({
    runOnJS: true, activeOffsetX: [-SWIPE_START, SWIPE_START], failOffsetY: [-SWIPE_FAIL_VERTICAL, SWIPE_FAIL_VERTICAL],
    onActivate: swipe.onStart,
    onUpdate: event => drag.set(event.translationX * SWIPE_FOLLOW),
    onDeactivate: event => { drag.set(0); swipe.onEnd(event.translationX, event.velocityX); },
  });
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: drag.get() }] }), [drag]);
  return <GestureDetector gesture={gesture} touchAction="pan-y"><Animated.View testID="calendar-swipe" style={[styles.fill, follow]}>{children}</Animated.View></GestureDetector>;
}

/** What a tapped slot can start: an appointment or a block at its time. */
function SlotChoice({ t, slot, closeSlot, addAtSlot, blockAtSlot }: Pick<BusinessCalendarView, 't' | 'slot' | 'closeSlot' | 'addAtSlot' | 'blockAtSlot'>) {
  return <FormDialog testID="calendar-slot-choice" title={slot?.title ?? ''} open={slot !== null} onClose={closeSlot}>
    <View className="gap-3">
      <ActionButton testID="calendar-slot-add" label={t('calendar.slotAdd')} onPress={addAtSlot} />
      <ActionButton secondary testID="calendar-slot-block" label={t('calendar.slotBlock')} onPress={blockAtSlot} />
    </View>
  </FormDialog>;
}

/**
 * The business calendar (decisions.md, "The calendar screen" — 2026-11-11): a week, three days or a day of
 * appointments and blocks on the business's hours. A day header opens that day; an appointment or a block opens its
 * sheet; a slot something can start in asks whether to add an appointment or block time there.
 */
export function BusinessCalendar(view: BusinessCalendarView) {
  const { t, status, mode, columns } = view;
  const closedDay = mode === 'day' && status === 'ready' && !columns[0]?.hours?.windows.length;
  const booking = view.openAppointment, block = view.openBlock;
  return <GestureHandlerRootView style={styles.fill}><View className="flex-1 bg-canvas">
    <View className="mx-auto w-full flex-1" style={{ maxWidth: 960 }}>
      <CalendarHeader {...view} />
      {status === 'error' ? <View className="gap-2 p-4"><Text accessibilityRole="alert">{t('calendar.loadFailure')}</Text><ActionButton secondary label={t('common.retry')} onPress={view.retry} /></View>
        : <>
          {closedDay ? <Text testID="calendar-closed" className="px-4 pt-2 text-sm text-muted">{t('calendar.closedDay')}</Text> : null}
          {view.feedback ? <Text accessibilityRole="alert" className="px-4 pt-2 text-danger">{view.feedback}</Text> : null}
          <Swipeable swipe={view.swipe}>
            <CalendarDayHeaders {...view} />
            {/* Focusable itself: a closed day has no button inside, and a keyboard must still be able to scroll it (axe scrollable-region-focusable). */}
            <ScrollView focusable className="flex-1" contentContainerClassName="pb-10 pt-2"><CalendarTimeGrid {...view} /></ScrollView>
            {/* Over the grid, not above it: the grid keeps its place while the period loads and when it arrives. */}
            {status === 'loading' ? <View testID="calendar-loading" pointerEvents="none" className="absolute inset-x-0 top-14 items-center">
              <View role="status" className="flex-row items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
                <ActivityIndicator size="small" color={tokens.color.brand} />
                <Text className="text-sm text-body">{t('calendar.loading')}</Text>
              </View>
            </View> : null}
          </Swipeable>
        </>}
    </View>
    <SlotChoice {...view} />
    <ManualBookingDialog {...view.manual} />
    <TimeBlockDialog staff={view.staff} {...view.blockDialog} />
    {/* Until the appointment screen exists, a tapped appointment opens the home's card, unfolded, in a sheet. */}
    <FormDialog testID="calendar-appointment" title={t('calendar.appointmentTitle')} open={booking !== null} onClose={view.closeEntry}>
      {booking ? <AgendaAppointmentCard key={booking.id} initiallyOpen booking={booking} span={view.span(booking.startsAt, booking.endsAt)} t={t} contact={view.contact}
        lifecycle={<AppointmentAudit key={`${view.businessId}:${booking.id}`} booking={booking} timezone={view.timezone} businessId={view.businessId} quiet />} /> : null}
    </FormDialog>
    {/* A block's details and its release, as on the home. */}
    <FormDialog testID="calendar-block" title={t('dashboard.blockTitle')} open={block !== null} onClose={view.closeEntry}>
      {block ? <TimeBlockRow block={block} t={t} locale={view.locale} {...view.blockRemoval} /> : null}
    </FormDialog>
  </View></GestureHandlerRootView>;
}
const styles = StyleSheet.create({ fill: { flex: 1 } });

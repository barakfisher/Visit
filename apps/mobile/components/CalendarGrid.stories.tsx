import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';
import { expect, fn, userEvent } from 'storybook/test';
import { CalendarHeader } from './BusinessCalendar.component';
import { CalendarDayHeaders, CalendarTimeGrid } from './CalendarGrid.component';
import { translate } from '../src/i18n/messages';
import { calendarColumns, calendarMonthTitle } from '../src/lib/CalendarColumns';
import { periodDates, type CalendarMode, type DayHours } from '../src/lib/CalendarGrid';
import { dateRange, fullDate } from '../src/lib/appointmentTime';
import type { AgendaAppointment } from '../src/types/ProviderAgenda.types';
import type { TimeBlock } from '../src/types/TimeBlocks.types';

const he = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('he', key, values);
const zone = 'Asia/Jerusalem', today = '2026-11-11';
// 13:20 in Israel on Wednesday 11 November 2026: the "now" line sits there, and earlier slots cannot be tapped.
const now = Date.parse('2026-11-11T11:20:00Z');
const at = (date: string, local: string) => new Date(`${date}T${local}:00+02:00`).toISOString();
const booking = (id: string, date: string, from: string, until: string, name: string, service = 'תספורת'): AgendaAppointment => ({ id, status: 'CONFIRMED', revision: 1, startsAt: at(date, from), endsAt: at(date, until), customer: { displayName: name, phone: '+972501234567', email: null }, service: { name: service }, staff: { displayName: 'ברק' } });
const hours: DayHours[] = [...periodDates(today, 'week'), ...periodDates('2026-11-18', 'week')].map(date => ({ date, windows: date === '2026-11-14' || date === '2026-11-21' ? [] : date === '2026-11-13' || date === '2026-11-20' ? [{ startLocal: '08:00', endLocal: '13:00' }] : [{ startLocal: '09:00', endLocal: '19:00' }] }));
const bookings = [
  booking('a', '2026-11-08', '09:00', '09:30', 'נועה כהן'), booking('b', '2026-11-09', '12:00', '13:00', 'דוד לוי', 'צבע'),
  booking('c', today, '10:00', '10:45', 'מיכל אברהם'), booking('d', today, '10:30', '11:00', 'יוסי'),
  booking('e', today, '15:00', '16:00', 'אורית שמעוני', 'פן'), booking('f', '2026-11-12', '17:30', '18:00', 'רון'),
];
const blocks: TimeBlock[] = [
  { id: 'lunch', startsAt: at(today, '13:00'), endsAt: at(today, '13:30'), allDay: false, reason: 'הפסקה', staff: null, fromDate: today, toDate: today, startLocal: '13:00', endLocal: '13:30' },
  { id: 'off', startsAt: at('2026-11-13', '00:00'), endsAt: at('2026-11-14', '00:00'), allDay: true, reason: 'חופש', staff: null, fromDate: '2026-11-13', toDate: '2026-11-13' },
];

function Calendar({ mode, date, empty, chooseSlot, openEntry, openDay, previous, next }: { mode: CalendarMode; date: string; empty?: boolean; chooseSlot: () => void; openEntry: () => void; openDay: () => void; previous: () => void; next: () => void }) {
  const dates = periodDates(date, mode), from = dates[0]!, to = dates[dates.length - 1]!;
  const { columns, grid } = calendarColumns({ agenda: empty ? { bookings: [], blocks: [], hours } : { bookings, blocks, hours }, dates, timezone: zone, today, now, locale: 'he' });
  const props = { t: he, mode, columns, grid, clock: { today, minute: 13 * 60 + 20 }, chooseSlot, openEntry, openDay };
  return <View style={{ maxWidth: 390, height: 760 }}>
    <CalendarHeader t={he} mode={mode} setMode={fn()} monthTitle={calendarMonthTitle(from, to, 'he')} rangeTitle={mode === 'day' ? fullDate(date, 'he') : dateRange(from, to, 'he')} previous={previous} next={next} goToday={fn()} showsToday={dates.includes(today)} />
    <CalendarDayHeaders {...props} />
    <View focusable style={{ flex: 1, overflow: 'scroll' }}><CalendarTimeGrid {...props} /></View>
  </View>;
}
const meta = { globals: { locale: 'he' }, title: 'Provider/Calendar', component: Calendar, args: { mode: 'week', date: today, chooseSlot: fn(), openEntry: fn(), openDay: fn(), previous: fn(), next: fn() } } satisfies Meta<typeof Calendar>;
export default meta;
type Story = StoryObj<typeof meta>;

// The week: month and dates, the day headers, a day blocked whole filled with its block, overlapping appointments side by side.
export const Week: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByTestId('calendar-month')).toHaveTextContent('נובמבר 2026');
  await expect(canvas.getByTestId('calendar-now')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /מיכל אברהם/ })); await expect(args.openEntry).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: /חופש/ })); await expect(args.openEntry).toHaveBeenCalledTimes(2);
  await userEvent.click(canvas.getByTestId('calendar-day-2026-11-12')); await expect(args.openDay).toHaveBeenCalledOnce();
  // A slot ahead in working hours asks what to start; one already past, outside hours or on a day blocked whole is not a button.
  await userEvent.click(canvas.getByTestId('calendar-slot-2026-11-12-14:00')); await expect(args.chooseSlot).toHaveBeenCalledWith('2026-11-12', '14:00');
  await expect(canvas.queryByTestId('calendar-slot-2026-11-11-09:00')).toBeNull();
  await expect(canvas.queryByTestId('calendar-slot-2026-11-12-08:00')).toBeNull();
  await expect(canvas.queryByTestId('calendar-slot-2026-11-13-10:00')).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: he('calendar.nextWeek') })); await expect(args.next).toHaveBeenCalledOnce();
} };
// One day, wide enough for the time, the customer and the service.
export const Day: Story = { args: { mode: 'day' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('button', { name: /אורית שמעוני/ })).toBeVisible();
  await expect(canvas.getByRole('button', { name: he('calendar.nextDay') })).toBeVisible();
} };
// Three days from the chosen date: wider columns, and the arrows step three days.
export const ThreeDays: Story = { args: { mode: 'threeDays', date: '2026-11-12' }, play: async ({ canvas }) => {
  await expect(canvas.getByTestId('calendar-day-2026-11-12')).toBeVisible();
  await expect(canvas.getByTestId('calendar-day-2026-11-14')).toBeVisible();
  await expect(canvas.queryByTestId('calendar-day-2026-11-11')).toBeNull();
  await expect(canvas.getByRole('button', { name: he('calendar.nextThreeDays') })).toBeVisible();
} };
// A week with nothing booked still shows its hours, shaded outside them.
export const EmptyWeek: Story = { args: { empty: true, date: '2026-11-18' } };
// Saturday has no hours: its whole column is in the unavailable shade and nothing in it is a button.
export const ClosedDay: Story = { args: { mode: 'day', date: '2026-11-14' }, play: async ({ canvas }) => {
  await expect(canvas.queryByTestId('calendar-slot-2026-11-14-10:00')).toBeNull();
} };

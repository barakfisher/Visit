import { useState } from 'react';
import { bookingMonthCells } from '../src/lib/CompactBooking.utils';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { CompactBookingControls } from './CompactBookingControls.component';
import type { useCompactBooking } from '@/src/lib/CompactBooking.hook';
import { en } from '@/src/i18n/messages';
const controls: ReturnType<typeof useCompactBooking> = {
  direction: 'ltr', sheet: null, open: fn(), close: fn(), choices: [{ id: 'service', label: 'Consultation with a deliberately long service name', summary: '30 min · ₪120', selected: true }], chosen: { id: 'service', label: 'Consultation with a deliberately long service name', summary: '30 min · ₪120', selected: true }, selectService: fn(), month: '2026-10', monthTitle: 'October 2026', dateTitle: 'Tuesday, October 27, 2026', weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], cells: [], selectDate: fn(), previousMonth: fn(), nextMonth: fn(), canPreviousMonth: false, canNextMonth: true, calendarLoading: false, calendarError: false, retryCalendar: fn(), preferred: '', validPreferred: true, changePreferred: fn(), page: [{ id: 'staff:instant', label: '09:00 · Specialist' }], earlier: fn(), later: fn(), hasEarlier: false, hasLater: true, pageSummary: 'Times 1–6 of 12', nextDate: fn(), searching: false, searchNotice: '', canSearch: true, timeNote: 'Times are local to this business.',
};
const meta = { title: 'Booking/Compact controls', component: CompactBookingControls, args: { controls, t: key => en[key], disabled: false, date: '2026-10-27', selectedId: null, slotLoading: false, slotError: false, onRetrySlots: fn(), onSelectSlot: fn() } } satisfies Meta<typeof CompactBookingControls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: '09:00 · Specialist' })); await expect(args.onSelectSlot).toHaveBeenCalledWith('staff:instant'); await expect(canvas.getByRole('button', { name: 'Earlier' })).toHaveAttribute('aria-disabled', 'true'); } };
export const Empty: Story = { args: { controls: { ...controls, page: [] } }, play: async ({ canvas }) => { await expect(canvas.getByRole('button', { name: 'Find the next available date' })).toBeVisible(); } };
export const Loading: Story = { args: { slotLoading: true }, play: async ({ canvas }) => { await expect(canvas.queryByRole('button', { name: '09:00 · Specialist' })).toBeNull(); } };
export const Failed: Story = { args: { slotError: true }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: 'Try again' })); await expect(args.onRetrySlots).toHaveBeenCalled(); } };
export const NoServices: Story = { args: { controls: { ...controls, chosen: undefined, choices: [], page: [] } }, play: async ({ canvas }) => { await expect(canvas.getByRole('button', { name: /Choose a service/ })).toHaveAttribute('aria-disabled', 'true'); await expect(canvas.getByRole('button', { name: /Choose a date/ })).toHaveAttribute('aria-disabled', 'true'); } };
export const ClosedCalendar: Story = { args: { controls: { ...controls, sheet: 'calendar', cells: [null, { date: '2026-10-27', day: '27', label: 'October 27 closed', available: false, selected: false }, { date: '2026-10-28', day: '28', label: 'October 28 available', available: true, selected: true }] } }, play: async ({ canvasElement, args }) => {
  const body = within(canvasElement.ownerDocument.body);
  await expect(body.getByRole('button', { name: 'October 27 closed' })).toBeDisabled();
  const day = body.getByRole('button', { name: 'October 28 available' });
  await expect(day).toHaveAttribute('aria-pressed', 'true'); day.focus(); await userEvent.keyboard('{Enter}');
  await expect(args.controls.selectDate).toHaveBeenCalledWith('2026-10-28');
} };
export const NoDates: Story = { args: { controls: { ...controls, sheet: 'calendar', cells: [], canNextMonth: false, canPreviousMonth: false } } };
export const CalendarFailed: Story = { args: { controls: { ...controls, sheet: 'calendar', calendarError: true } } };
export const CalendarLoading: Story = { args: { controls: { ...controls, sheet: 'calendar', calendarLoading: true } } };
export const ServiceSelection: Story = { args: { controls: { ...controls, sheet: 'service' } }, play: async ({ canvasElement, args }) => {
  const body = within(canvasElement.ownerDocument.body);
  const service = body.getByRole('button', { name: /Consultation.*30 min/ });
  await expect(service).toHaveAttribute('aria-pressed', 'true'); service.focus(); await userEvent.keyboard(' ');
  await expect(args.controls.selectService).toHaveBeenCalledWith('service');
} };
export const Pagination: Story = { play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: 'Later' })); await expect(args.controls.later).toHaveBeenCalledOnce(); } };
export const InvalidPreference: Story = { args: { controls: { ...controls, preferred: '25:99', validPreferred: false } }, play: async ({ canvas }) => { await expect(canvas.getByRole('alert')).toBeVisible(); await expect(canvas.queryByRole('button', { name: '09:00 · Specialist' })).toBeNull(); } };
export const ConflictRemoved: Story = { args: { controls: { ...controls, page: [], searchNotice: 'This time is no longer available. Choose another time.' } }, play: async ({ canvas }) => { await expect(canvas.queryByRole('button', { name: '09:00 · Specialist' })).toBeNull(); } };

function InteractiveFixture() {
  const [sheet, setSheet] = useState<'service' | 'calendar' | null>(null);
  const [date, setDate] = useState('2026-10-28');
  return <CompactBookingControls controls={{ ...controls, sheet, open: setSheet, close: () => setSheet(null), cells: bookingMonthCells('2026-10', ['2026-10-28', '2026-10-29'], date, 'en-US'), selectDate: value => { setDate(value); setSheet(null); }, selectService: () => setSheet(null) }} t={key => en[key]} disabled={false} date={date} selectedId={null} slotLoading={false} slotError={false} onRetrySlots={fn()} onSelectSlot={fn()} />;
}
export const InteractiveCalendar: Story = { render: () => <InteractiveFixture />, play: async ({ canvas, canvasElement }) => {
  const trigger = canvas.getByTestId('booking-date-trigger');
  trigger.focus(); await userEvent.keyboard('{Enter}');
  const body = within(canvasElement.ownerDocument.body);
  const day = body.getByTestId('booking-day-2026-10-29'); day.focus(); await userEvent.keyboard('{Enter}');
  await expect(trigger).toHaveFocus(); await expect(trigger).toHaveAttribute('aria-label', expect.stringContaining('2026-10-29'));
} };

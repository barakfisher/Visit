import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
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

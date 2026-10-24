import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { HorizontalCalendarBar } from './HorizontalCalendarBar';

const days = [
  { id: '2026-10-26', label: 'MON', dateLabel: '26', accessibilityLabel: 'Monday, October 26, 2026' },
  { id: '2026-10-27', label: 'TUE', dateLabel: '27', accessibilityLabel: 'Tuesday, October 27, 2026' },
  { id: '2026-10-28', label: 'WED', dateLabel: '28', accessibilityLabel: 'Wednesday, October 28, 2026', disabled: true },
  { id: '2026-10-29', label: 'THU', dateLabel: '29', accessibilityLabel: 'Thursday, October 29, 2026' },
  { id: '2026-10-30', label: 'FRI', dateLabel: '30', accessibilityLabel: 'Friday, October 30, 2026' },
];

const meta = { title: 'Booking/HorizontalCalendarBar', component: HorizontalCalendarBar, args: { days, selectedId: '2026-10-27' } } satisfies Meta<typeof HorizontalCalendarBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DateSelection: Story = { args: { onSelect: fn() }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: /THU/ }));
  await expect(args.onSelect).toHaveBeenCalledWith('2026-10-29');
} };
export const NoneAvailable: Story = { args: { days: days.map((day) => ({ ...day, disabled: true })), selectedId: undefined } };

export const HorizontalScrolling: Story = { render: (args) => <View style={{ width: 320 }}><HorizontalCalendarBar {...args}/></View>, play: async ({ canvas }) => { const scroller = canvas.getByLabelText('Available dates'); scroller.scrollLeft = 500; await expect(scroller.scrollLeft).toBeGreaterThan(0); }, args: { days: Array.from({ length: 20 }, (_, index) => ({ id: `future-${index}`, label: 'DAY', dateLabel: String(index + 1), accessibilityLabel: `Future day ${index + 1}` })) } };
export const ClosedWeekends: Story = { args: { days: [
  { id: '2026-10-30', label: 'FRI', dateLabel: '30', accessibilityLabel: 'October 30' },
  { id: '2026-10-31', label: 'SAT', dateLabel: '31', accessibilityLabel: 'October 31 (closed)', disabled: true },
  { id: '2026-11-01', label: 'SUN', dateLabel: '1', accessibilityLabel: 'November 1 (closed)', disabled: true },
], onSelect: fn() }, play: async ({ canvas, args }) => { const saturday = canvas.getByRole('button', { name: /SAT/ }); await expect(saturday).toHaveAttribute('aria-disabled', 'true'); await expect(args.onSelect).not.toHaveBeenCalled(); } };
export const FutureDateSelection: Story = { args: { onSelect: fn() }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: /FRI/ })); await expect(args.onSelect).toHaveBeenCalledWith('2026-10-30'); } };

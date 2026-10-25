import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { ActiveBookings } from './ActiveBookings';
import { ActiveBookingCard } from './ActiveBookingCard';

const meta = { title: 'Booking/ActiveBookingCard', component: ActiveBookingCard, args: { service: 'Initial consultation', provider: 'Maya Cohen', dateLabel: 'Tuesday, October 27', timeLabel: '10:30', timezone: 'Asia/Jerusalem' } } satisfies Meta<typeof ActiveBookingCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Upcoming: Story = { args: { onReschedule: fn(), onCancel: fn() }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Reschedule' }));
  await expect(args.onReschedule).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
  await expect(args.onCancel).toHaveBeenCalledOnce();
} };

export const SingleActiveBooking: Story = { args: { onReschedule: fn(), onCancel: fn() } };
export const PendingHomeActions: Story = { args: { actionsPending: true }, play: async ({ canvas }) => { await expect(canvas.getByRole('button', { name: 'Reschedule (coming soon)' })).toBeDisabled(); await expect(canvas.getByRole('button', { name: 'Cancel (coming soon)' })).toBeDisabled(); } };

const booking = { id: 'one', startsAt: '2026-11-02T10:30:00Z', service: { id: 'service', name: 'Consultation' }, business: { id: 'business', name: 'North Studio', timezone: 'UTC' }, staff: { displayName: 'Alex' } };
export const MultipleBookings: Story = { args: { onReschedule: fn() }, render: (args) => <ActiveBookings bookings={[booking, { ...booking, id: 'two', service: { id: 'second', name: 'Follow-up visit' } }]} onReschedule={args.onReschedule}/>, play: async ({ canvas, args }) => { await userEvent.click(canvas.getAllByRole('button', { name: 'Reschedule' })[1]!); await expect(args.onReschedule).toHaveBeenCalledOnce(); } };
export const EmptyState: Story = { render: () => <ActiveBookings bookings={[]}/>, play: async ({ canvas }) => { await expect(canvas.getByText(/No upcoming appointments/)).toBeVisible(); await expect(canvas.queryAllByRole('button')).toHaveLength(0); } };

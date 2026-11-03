import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { ActiveBookings } from './ActiveBookings';
import { ActiveBookingCard } from './ActiveBookingCard';
import { translate } from '../src/i18n/messages';

const meta = { title: 'Booking/ActiveBookingCard', component: ActiveBookingCard, args: { service: 'Initial consultation', provider: 'Maya Cohen', dateLabel: 'Tuesday, October 27', timeLabel: '10:30', timezone: 'Asia/Jerusalem', label: translate('en', 'ui.nextVisit') } } satisfies Meta<typeof ActiveBookingCard>;
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
const stackedBelow = (upper: HTMLElement, lower: HTMLElement) => lower.getBoundingClientRect().top >= upper.getBoundingClientRect().bottom;
export const MultipleBookings: Story = { args: { onReschedule: fn() }, render: (args) => <ActiveBookings bookings={[booking, { ...booking, id: 'two', service: { id: 'second', name: 'Follow-up visit' } }]} onReschedule={args.onReschedule} footer={item => <span>{`footer ${item.id}`}</span>}/>, play: async ({ canvas, args }) => {
  const first = canvas.getByTestId('active-booking-one'), second = canvas.getByTestId('active-booking-two');
  await expect(stackedBelow(first, second)).toBe(true);
  await expect(canvas.getAllByText(translate('en', 'ui.nextVisit'))).toHaveLength(1);
  await expect(first).toHaveTextContent(translate('en', 'ui.nextVisit'));
  await expect(second).toHaveTextContent('footer two');
  await userEvent.click(canvas.getAllByRole('button', { name: 'Reschedule' })[1]!); await expect(args.onReschedule).toHaveBeenCalledOnce();
} };
export const HebrewMultipleBookings: Story = { globals: { locale: 'he' }, render: () => <ActiveBookings bookings={[booking, { ...booking, id: 'two' }, { ...booking, id: 'three' }]} onReschedule={fn()} onCancel={fn()}/>, play: async ({ canvas }) => {
  const cards = ['one', 'two', 'three'].map(id => canvas.getByTestId(`active-booking-${id}`));
  await expect(stackedBelow(cards[0]!, cards[1]!) && stackedBelow(cards[1]!, cards[2]!)).toBe(true);
  await expect(canvas.getAllByText(translate('he', 'ui.nextVisit'))).toHaveLength(1);
  await expect(cards[0]).toHaveTextContent(translate('he', 'ui.nextVisit'));
} };
export const EmptyState: Story = { render: () => <ActiveBookings bookings={[]}/>, play: async ({ canvas }) => { await expect(canvas.getByText(/No upcoming appointments/)).toBeVisible(); await expect(canvas.queryAllByRole('button')).toHaveLength(0); } };
const locked = { canCancel: false, canReschedule: false }, open = { canCancel: true, canReschedule: true };
export const InsideChangeWindow: Story = { args: { onReschedule: fn(), onCancel: fn() }, render: (args) => <ActiveBookings bookings={[{ ...booking, actions: locked }, { ...booking, id: 'two', actions: { ...open, canCancel: false } }]} onReschedule={args.onReschedule} onCancel={args.onCancel}/>, play: async ({ canvas }) => {
  await expect(canvas.getByText(translate('en', 'lifecycle.lockedBoth'))).toBeVisible();
  await expect(canvas.getByText(translate('en', 'lifecycle.lockedCancel'))).toBeVisible();
  await expect(canvas.queryAllByRole('button', { name: 'Cancel' })).toHaveLength(0);
  await expect(canvas.getAllByRole('button', { name: 'Reschedule' })).toHaveLength(1);
} };
export const CancelRefusedOnItsCard: Story = { args: { onCancel: fn() }, render: (args) => <ActiveBookings bookings={[{ ...booking, actions: open }, { ...booking, id: 'two', actions: open }]} onCancel={args.onCancel} error={{ bookingId: 'two', message: translate('en', 'lifecycle.cancelCutoff') }}/>, play: async ({ canvas }) => {
  const alerts = canvas.getAllByRole('alert');
  await expect(alerts).toHaveLength(1); await expect(alerts[0]).toHaveTextContent(translate('en', 'lifecycle.cancelCutoff'));
  await expect(canvas.getByTestId('active-booking-two')).toContainElement(alerts[0]!);
} };
export const HebrewInsideChangeWindow: Story = { globals: { locale: 'he' }, render: () => <ActiveBookings bookings={[{ ...booking, actions: locked }]} onCancel={fn()} onReschedule={fn()} error={{ bookingId: 'one', message: translate('he', 'lifecycle.cancelCutoff') }}/>, play: async ({ canvas }) => {
  await expect(canvas.getByText(translate('he', 'lifecycle.lockedBoth'))).toBeVisible();
  await expect(canvas.queryAllByRole('button')).toHaveLength(0);
} };

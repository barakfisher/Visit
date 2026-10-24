import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { AvailabilityState } from './AvailabilityState';

const meta = { title: 'Booking/AvailabilityState', component: AvailabilityState } satisfies Meta<typeof AvailabilityState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { state: 'loading' } };
export const Empty: Story = { args: { state: 'empty' } };
export const Available: Story = { args: { state: 'available' } };
export const RecoverableError: Story = {
  args: { state: 'error', onRetry: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

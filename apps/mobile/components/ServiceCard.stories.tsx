import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { ServiceCard } from './ServiceCard';

const meta = { title: 'Booking/ServiceCard', component: ServiceCard, args: { name: 'Initial consultation', description: 'A one-to-one appointment with your provider.', durationMinutes: 45, priceLabel: '$65' } } satisfies Meta<typeof ServiceCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  args: { onPress: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Initial consultation/ }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
export const Selected: Story = { args: { selected: true } };
export const Unavailable: Story = { args: { disabled: true } };

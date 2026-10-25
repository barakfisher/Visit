import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { TimeChip } from './TimeChip';

const meta = { title: 'Booking/TimeChip', component: TimeChip, args: { label: '10:30', timezone: 'Asia/Jerusalem' } } satisfies Meta<typeof TimeChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = { args: { onPress: fn() }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: /10:30/ }));
  await expect(args.onPress).toHaveBeenCalledOnce();
  await expect(canvas.queryByText('Asia/Jerusalem')).not.toBeInTheDocument();
} };
export const Selected: Story = { args: { selected: true } };
export const Unavailable: Story = { args: { disabled: true } };

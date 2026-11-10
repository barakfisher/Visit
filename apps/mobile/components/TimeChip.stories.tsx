import { useState } from 'react';
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
// Choosing a time changes its colour and adds a check beside it; the chip keeps its exact size, so nothing around it moves.
function ChoosableChip(args: Parameters<typeof TimeChip>[0]) { const [selected, setSelected] = useState(false); return <TimeChip {...args} selected={selected} onPress={() => setSelected(true)} />; }
export const SelectingKeepsItsSize: Story = { render: (args) => <ChoosableChip {...args} />, play: async ({ canvas }) => {
  const chip = canvas.getByRole('button', { name: /10:30/ });
  const before = chip.getBoundingClientRect();
  await userEvent.click(chip);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveTextContent('✓');
  const after = chip.getBoundingClientRect();
  await expect([after.width, after.height]).toEqual([before.width, before.height]);
} };
// A long time-and-staff label wraps inside its chip instead of running over the next one.
export const LongLabelStaysInside: Story = { args: { label: '10:15 · A specialist with a very long display name', onPress: fn() }, decorators: [Story => <div style={{ width: 200 }}><Story /></div>], play: async ({ canvas }) => {
  const chip = canvas.getByRole('button'); const text = canvas.getByText(/A specialist/);
  const outer = chip.getBoundingClientRect(), inner = text.getBoundingClientRect();
  await expect(inner.left >= outer.left - 1 && inner.right <= outer.right + 1).toBe(true);
} };

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { BookingFinalAction } from './BookingFinalAction.component';
const meta = { title: 'Booking/Final consent', component: BookingFinalAction, args: { label: 'Confirm appointment', busy: false, disabled: false, onConfirm: fn() } } satisfies Meta<typeof BookingFinalAction>;
export default meta;
type Story = StoryObj<typeof meta>;
function ProcessingFixture({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <BookingFinalAction label={busy ? 'Processing appointment…' : 'Confirm appointment'} busy={busy} disabled={false} onConfirm={() => { setBusy(true); return onConfirm(); }} />;
}
export const ExplicitConsentOnce: Story = { render: args => <ProcessingFixture onConfirm={args.onConfirm} />, play: async ({ canvas, args }) => {
  await expect(args.onConfirm).not.toHaveBeenCalled();
  await userEvent.dblClick(canvas.getByRole('button', { name: 'Confirm appointment' }));
  await expect(args.onConfirm).toHaveBeenCalledOnce();
  await expect(canvas.getByRole('button', { name: 'Processing appointment…' })).toBeDisabled();
} };
export const Processing: Story = { args: { label: 'Processing appointment…', busy: true } };
export const Expired: Story = { args: { label: 'Choose another time', disabled: true }, play: async ({ canvas, args }) => { await expect(canvas.getByRole('button')).toBeDisabled(); canvas.getByRole('button').click(); await expect(args.onConfirm).not.toHaveBeenCalled(); } };

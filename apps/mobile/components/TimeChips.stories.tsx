import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { slotLabels } from '@/src/lib/slotLabels';
import { TimeChips } from './TimeChips';
const slots = [{ id: '0900', label: '09:00' }, { id: '0930', label: '09:30' }, { id: '1000', label: '10:00' }];
const meta = { title: 'Booking/TimeChips', component: TimeChips, args: { slots, timezone: 'Asia/Jerusalem' } } satisfies Meta<typeof TimeChips>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { onSelect: fn() }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: /09:30/ })); await expect(args.onSelect).toHaveBeenCalledWith('0930'); } };
export const Selected: Story = { args: { selectedId: '0930' } };
export const Locked: Story = { args: { slots: slots.map((slot) => ({ ...slot, locked: true })), onSelect: fn() }, play: async ({ canvas, args }) => { const slot = canvas.getByRole('button', { name: /09:00/ }); await expect(slot).toHaveAttribute('aria-disabled', 'true'); await expect(args.onSelect).not.toHaveBeenCalled(); } };
export const Disabled: Story = { args: { slots: slots.map((slot) => ({ ...slot, disabled: true })) } };
export const SkeletonLoading: Story = { args: { loading: true }, play: async ({ canvas }) => { await expect(canvas.queryAllByRole('button')).toHaveLength(0); } };

const foldLabels = slotLabels([{ staffId: 'alex', staffName: 'Alex', localTime: '01:30', utcOffset: '+03:00' }, { staffId: 'alex', staffName: 'Alex', localTime: '01:30', utcOffset: '+02:00' }]);
export const RepeatedClockTime: Story = { args: { slots: foldLabels.map((label, index) => ({ id: `fold-${index}`, label })), onSelect: fn() }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('button', { name: /first occurrence/ })).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /second occurrence/ }));
  await expect(args.onSelect).toHaveBeenCalledWith('fold-1');
} };
// Time-and-staff labels in a Hebrew layout at phone width: every chip stays clickable, none covers another.
const staffed = ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15'].map(time => ({ id: time, label: `${time} · Pilot expert edited` }));
export const HebrewStaffedLabels: Story = { globals: { locale: 'he' }, args: { slots: staffed, onSelect: fn() }, decorators: [Story => <div style={{ width: 343 }}><Story /></div>], play: async ({ canvas, args }) => {
  for (const slot of staffed) { const chip = canvas.getByRole('button', { name: new RegExp(slot.label) }); const box = chip.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); await expect(chip.contains(hit)).toBe(true); }
  await userEvent.click(canvas.getByRole('button', { name: /11:00/ })); await expect(args.onSelect).toHaveBeenCalledWith('11:00');
} };

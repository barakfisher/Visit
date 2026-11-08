import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { SavedProviderCard } from './SavedProviderCard';
const item = { id: 'saved', businessId: 'business', available: true, provider: { id: 'business', name: 'Noa Studio', location: 'Jerusalem', category: 'Wellness' } };
const meta = { title: 'Home/SavedProviderCard', component: SavedProviderCard, args: { item, onBook: fn(), onRemove: fn() } } satisfies Meta<typeof SavedProviderCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: /^Noa Studio.*Book appointment$/ })); await expect(args.onBook).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: 'Remove Noa Studio from my list' })); await expect(args.onRemove).toHaveBeenCalledOnce(); await expect(args.onBook).toHaveBeenCalledOnce();
} };
export const Unavailable: Story = { args: { item: { ...item, available: false, provider: { id: 'business', name: 'Previously saved studio' } } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('button', { name: /^Previously saved studio.*Not accepting bookings$/ })).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(canvas.getByRole('button', { name: 'Remove Previously saved studio from my list' })); await expect(args.onRemove).toHaveBeenCalledOnce();
} };
export const Removing: Story = { args: { removing: true } };
export const LongName: Story = { args: { item: { ...item, provider: { ...item.provider, name: 'A neighborhood studio with a long business name that wraps onto several readable lines' } } } };

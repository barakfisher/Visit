import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { tokens } from '@/src/design/tokens';
import { ActionButton } from './ActionButton';
const meta = { title: 'Foundation/ActionButton', component: ActionButton, args: { label: 'Confirm appointment', onPress: fn() }, decorators: [Story => <View style={{ width: 280 }}><Story /></View>] } satisfies Meta<typeof ActionButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { play: async ({ canvas, args }) => { const button = canvas.getByRole('button', { name: args.label }); await userEvent.click(button); await expect(args.onPress).toHaveBeenCalledOnce(); } };
export const Busy: Story = { args: { busy: true }, play: async ({ canvas, args }) => {
  const button = canvas.getByRole('button', { name: args.label });
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(tokens.layout.actionHeight);
  await expect(canvas.getByRole('progressbar', { name: args.label })).toBeVisible();
  button.click(); await expect(args.onPress).not.toHaveBeenCalled();
} };
export const Disabled: Story = { args: { disabled: true, label: 'Calendar export (not available yet)' }, play: async ({ canvas, args }) => { const button = canvas.getByRole('button', { name: args.label }); await expect(button).toHaveAttribute('aria-disabled', 'true'); button.click(); await expect(args.onPress).not.toHaveBeenCalled(); } };

import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { NavigationView } from './NavigationView.component';
import { translate } from '../src/i18n/messages';
const he = (key: Parameters<typeof translate>[1]) => translate('he', key);
const meta = { globals: { locale: 'he' }, title: 'Home/Navigation', component: NavigationView, args: { t: he, direction: 'rtl', providerMode: false, canSwitchMode: false, busy: false, error: '', bellLabel: he('notifications.bell'), bellBadge: null, onAccount: fn(), onNotifications: fn(), onSwitchMode: fn() } } satisfies Meta<typeof NavigationView>;
export default meta;
type Story = StoryObj<typeof meta>;
async function expectThumbInsideTrack(track: HTMLElement, thumb: HTMLElement) {
  const outer = track.getBoundingClientRect(), inner = thumb.getBoundingClientRect();
  await expect(inner.left).toBeGreaterThanOrEqual(outer.left);
  await expect(inner.right).toBeLessThanOrEqual(outer.right);
}
export const Customer: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.queryByRole('switch')).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: he('nav.account') })); await expect(args.onAccount).toHaveBeenCalledOnce();
} };
export const Unread: Story = { args: { bellLabel: translate('he', 'notifications.bell.other', { count: 12 }), bellBadge: '12', canSwitchMode: true }, play: async ({ canvas, args }) => {
  await expect(canvas.getByTestId('notification-badge')).toHaveTextContent('12');
  await userEvent.click(canvas.getByRole('button', { name: translate('he', 'notifications.bell.other', { count: 12 }) })); await expect(args.onNotifications).toHaveBeenCalledOnce();
} };
export const Manager: Story = { args: { canSwitchMode: true }, play: async ({ canvas, args }) => {
  const toggle = canvas.getByRole('switch', { name: he('nav.providerMode') });
  await expect(toggle).not.toBeChecked();
  await userEvent.click(toggle); await expect(args.onSwitchMode).toHaveBeenCalledOnce();
} };
export const ProviderMode: Story = { args: { canSwitchMode: true, providerMode: true }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('switch', { name: he('nav.providerMode') })).toBeChecked();
  await expect(canvas.getByTestId('provider-mode-strip')).toBeVisible();
  await expectThumbInsideTrack(canvas.getByTestId('mode-switch-track'), canvas.getByTestId('mode-switch-thumb'));
} };
export const Changed: Story = { args: { canSwitchMode: true, error: he('nav.changed') }, play: async ({ canvas }) => { await expect(canvas.getByRole('alert')).toBeVisible(); } };
export const English: Story = { globals: { locale: 'en' }, args: { t: key => translate('en', key), direction: 'ltr', canSwitchMode: true } };

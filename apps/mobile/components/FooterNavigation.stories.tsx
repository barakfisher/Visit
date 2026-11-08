import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { FooterNavigation } from './FooterNavigation.component';
const meta = { title: 'Home/Footer navigation', component: FooterNavigation, args: { tabs: [{ key: 'home', label: 'Home', active: true, onPress: fn() }, { key: 'appointments', label: 'My appointments', active: false, onPress: fn() }] } } satisfies Meta<typeof FooterNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Customer: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(canvas.getByRole('button', { name: 'My appointments' })); await expect(args.tabs[1]!.onPress).toHaveBeenCalledOnce();
} };
export const Provider: Story = { args: { tabs: [{ key: 'home', label: 'דף הבית', active: true, onPress: fn() }, { key: 'add', label: 'הוספת תור', active: false, onPress: fn() }, { key: 'team', label: 'הרשאות צוות', active: false, onPress: fn() }] }, globals: { locale: 'he' } };

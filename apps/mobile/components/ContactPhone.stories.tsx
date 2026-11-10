import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { translate, type MessageKey } from '@/src/i18n/messages';
import { ContactPhoneView } from './ContactPhone.component';

const t = (key: MessageKey) => translate('en', key);
const meta = {
  title: 'Account/ContactPhone', component: ContactPhoneView,
  args: { t, draft: '', setDraft: fn(), save: fn(async () => {}), status: 'idle', invalid: false, canSave: false, removing: false },
  decorators: [Story => <View style={{ width: 360 }}><Story /></View>],
} satisfies Meta<typeof ContactPhoneView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByText(translate('en', 'contactPhone.note'))).toBeVisible();
  await userEvent.type(canvas.getByRole('textbox', { name: translate('en', 'contactPhone.title') }), '0');
  await expect(args.setDraft).toHaveBeenCalled();
  await expect(canvas.getByRole('button', { name: translate('en', 'contactPhone.save') })).toHaveAttribute('aria-disabled', 'true');
} };
export const Changed: Story = { args: { draft: '050-1234567', canSave: true }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: translate('en', 'contactPhone.save') }));
  await expect(args.save).toHaveBeenCalledOnce();
} };
export const Invalid: Story = { args: { draft: '050-12', canSave: true, invalid: true }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(translate('en', 'contactPhone.invalid'));
  await expect(canvas.getByRole('textbox', { name: translate('en', 'contactPhone.title') })).toHaveAttribute('aria-invalid', 'true');
} };
export const Saving: Story = { args: { draft: '050-1234567', canSave: true, status: 'saving' }, play: async ({ canvas, args }) => {
  const button = canvas.getByRole('button', { name: translate('en', 'contactPhone.save') });
  await expect(button).toHaveAttribute('aria-busy', 'true');
  button.click(); await expect(args.save).not.toHaveBeenCalled();
} };
export const Saved: Story = { args: { draft: '050-1234567', status: 'saved' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('status')).toHaveTextContent(translate('en', 'contactPhone.saved'));
} };
export const Failed: Story = { args: { draft: '050-1234567', canSave: true, status: 'failed' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(translate('en', 'contactPhone.failed'));
} };
export const Removing: Story = { args: { canSave: true, removing: true }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: translate('en', 'contactPhone.remove') }));
  await expect(args.save).toHaveBeenCalledOnce();
} };

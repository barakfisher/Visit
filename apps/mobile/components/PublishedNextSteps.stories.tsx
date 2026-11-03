import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { View } from 'react-native';
import { translate } from '../src/i18n/messages';
import { PublishedNextSteps } from './PublishedNextSteps.component';
function Preview(props: { locale: 'he' | 'en'; onShare: () => void; onAgenda: () => void }) {
  return <View style={{ maxWidth: 600, padding: 16, direction: props.locale === 'he' ? 'rtl' : 'ltr' }}><PublishedNextSteps t={(key, values) => translate(props.locale, key, values)} onShare={props.onShare} onAgenda={props.onAgenda} /></View>;
}
const meta = { title: 'Provider/Published Next Steps', component: Preview, globals: { locale: 'he' }, args: { locale: 'he', onShare: fn(), onAgenda: fn() } } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hebrew: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('heading', { name: translate('he', 'published.title') })).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: translate('he', 'published.share') }));
  await expect(args.onShare).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: translate('he', 'published.agenda') }));
  await expect(args.onAgenda).toHaveBeenCalledOnce();
} };
export const English: Story = { args: { locale: 'en' }, globals: { locale: 'en' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('button', { name: translate('en', 'published.share') })).toBeVisible();
  await expect(canvas.getByRole('button', { name: translate('en', 'published.agenda') })).toBeVisible();
} };

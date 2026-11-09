import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { ArchivedProviders } from './ArchivedProviders.component';
import { translate } from '../src/i18n/messages';
const provider = (id: string, name: string, available = true) => ({ id: `saved-${id}`, businessId: id, available, provider: { id, name } });
const meta = { globals: { locale: 'he' }, title: 'Home/Archived providers', component: ArchivedProviders, args: {
  t: (key, values) => translate('he', key, values), bootstrapping: false, signedOut: false, state: 'ready', providers: [], hasMore: false, loadingMore: false, restoringId: null, restoreError: false,
  onRestore: fn(), onRetry: fn(), onMore: fn(), onBack: fn(),
} } satisfies Meta<typeof ArchivedProviders>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { play: async ({ canvas, args }) => { await expect(canvas.getByText(translate('he', 'archive.empty'))).toBeVisible(); await userEvent.click(canvas.getByRole('button', { name: translate('he', 'archive.back') })); await expect(args.onBack).toHaveBeenCalledOnce(); } };
export const Loading: Story = { args: { state: 'loading' }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toHaveTextContent(translate('he', 'archive.loading')); } };
export const Failed: Story = { args: { state: 'error' }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: translate('he', 'archive.retry') })); await expect(args.onRetry).toHaveBeenCalledOnce(); } };
export const Listed: Story = { args: { providers: [provider('one', 'סטודיו נועה'), provider('two', 'מרפאה שנסגרה', false)] }, play: async ({ canvas, args }) => {
  await expect(canvas.getByText(translate('he', 'home.notAccepting'))).toBeVisible();
  await userEvent.click(canvas.getAllByRole('button', { name: translate('he', 'archive.restore') })[0]!); await expect(args.onRestore).toHaveBeenCalledWith('one');
} };
export const Restoring: Story = { args: { providers: [provider('one', 'סטודיו נועה'), provider('two', 'מכון יופי')], restoringId: 'one' } };
export const RestoreFailed: Story = { args: { providers: [provider('one', 'סטודיו נועה')], restoreError: true }, play: async ({ canvas }) => { await expect(canvas.getByRole('alert')).toHaveTextContent(translate('he', 'archive.restoreFailure')); } };

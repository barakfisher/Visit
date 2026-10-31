import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { Home } from './Home.component';
import { translate } from '../src/i18n/messages';
const meta = { globals: { locale: 'he' }, title: 'Home/Screen', component: Home, args: {
  t: key => translate('he', key), identity: 'synthetic-customer', bootstrapping: false,
  upcoming: { state: 'hidden', heading: '', loadingLabel: '', error: '', retryLabel: '', appointment: null, additionalLabel: '', detailsLabel: '', cancelLabel: '', rescheduleLabel: '', busy: false, onRetry: fn(), onDetails: fn(), onAll: fn(), onCancel: fn(), onReschedule: fn() },
  providersState: 'ready', providers: [], hasMore: false, loadingMore: false, removingId: null, removeError: false,
  onAppointments: fn(), onRetryProviders: fn(), onMore: fn(), onBook: fn(), onRemove: fn(),
} } satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;
const providers = Array.from({ length: 5 }, (_, index) => ({ id: `saved-${index}`, businessId: `business-${index}`, available: true, provider: { id: `business-${index}`, name: `המרכז המקצועי לייעוץ ושירותים עם צוות המומחים ${index}`, location: 'תל אביב · רחוב ארוך במיוחד' } }));
export const Empty: Story = { play: async ({ canvas }) => { await expect(canvas.getByText(translate('he', 'home.empty'))).toBeVisible(); await expect(canvas.queryAllByText(/Explore|Discover/)).toHaveLength(0); } };
export const One: Story = { args: { providers: providers.slice(0, 1) }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: translate('he', 'home.book') })); await expect(args.onBook).toHaveBeenCalledOnce(); await expect(args.onBook).toHaveBeenCalledWith('business-0'); } };
export const Many: Story = { args: { providers, hasMore: true } };
export const English: Story = { args: { t: key => translate('en', key), providers: providers.map(p => ({ ...p, provider: { ...p.provider, name: 'Extended consultation and follow-up care with the specialist team' } })) }, globals: { locale: 'en' } };
export const Loading: Story = { args: { providersState: 'loading' } };
export const Failed: Story = { args: { providersState: 'error' }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: translate('he', 'home.retryProviders') })); await expect(args.onRetryProviders).toHaveBeenCalledOnce(); await expect(canvas.queryByText(translate('he', 'home.empty'))).toBeNull(); } };
export const Unavailable: Story = { args: { providers: [{ ...providers[0]!, available: false }], removeError: true } };

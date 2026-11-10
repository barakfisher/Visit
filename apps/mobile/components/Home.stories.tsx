import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Home } from './Home.component';
import { translate } from '../src/i18n/messages';
const meta = { globals: { locale: 'he' }, title: 'Home/Screen', component: Home, args: {
  t: (key, values) => translate('he', key, values), identity: 'synthetic-customer', bootstrapping: false,
  upcoming: { state: 'hidden', heading: '', loadingLabel: '', error: '', retryLabel: '', appointments: [], onRetry: fn(), onOpen: fn() },
  providersState: 'ready', providers: [], hasMore: false, loadingMore: false, removingId: null, removeError: false, hasArchive: false, removeName: null,
  onRetryProviders: fn(), onMore: fn(), onOpenProvider: fn(), onRemove: fn(), onConfirmRemove: fn(), onCancelRemove: fn(), onArchive: fn(),
} } satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;
const providers = Array.from({ length: 5 }, (_, index) => ({ id: `saved-${index}`, businessId: `business-${index}`, available: true, provider: { id: `business-${index}`, name: `המרכז המקצועי לייעוץ ושירותים עם צוות המומחים ${index}`, location: 'תל אביב · רחוב ארוך במיוחד' } }));
export const Empty: Story = { play: async ({ canvas }) => { await expect(canvas.getByText(translate('he', 'home.empty'))).toBeVisible(); await expect(canvas.queryAllByText(/Explore|Discover/)).toHaveLength(0); } };
export const One: Story = { args: { providers: providers.slice(0, 1) }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^${providers[0]!.provider.name}`) })); await expect(args.onOpenProvider).toHaveBeenCalledOnce(); await expect(args.onOpenProvider).toHaveBeenCalledWith('business-0'); } };
export const Many: Story = { args: { providers, hasMore: true } };
export const English: Story = { args: { t: (key, values) => translate('en', key, values), providers: providers.map(p => ({ ...p, provider: { ...p.provider, name: 'Extended consultation and follow-up care with the specialist team' } })) }, globals: { locale: 'en' } };
export const WithUpcomingAppointment: Story = { args: { providers: providers.slice(0, 3), upcoming: { state: 'ready', heading: translate('he', 'upcoming.next'), sectionHeading: true, loadingLabel: '', error: '', retryLabel: '', appointments: [{ id: 'today', when: 'היום · 14:30', place: 'Dana Studio · Tel Aviv' }], onRetry: fn(), onOpen: fn() } }, play: async ({ canvas }) => { await expect(canvas.getByRole('heading', { name: translate('he', 'upcoming.next') })).toBeVisible(); } };
export const Loading: Story = { args: { providersState: 'loading' } };
export const Failed: Story = { args: { providersState: 'error' }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: translate('he', 'home.retryProviders') })); await expect(args.onRetryProviders).toHaveBeenCalledOnce(); await expect(canvas.queryByText(translate('he', 'home.empty'))).toBeNull(); } };
export const Unavailable: Story = { args: { providers: [{ ...providers[0]!, available: false }], removeError: true } };
export const ProvidersHideTheWelcome: Story = { args: { providers: providers.slice(0, 2) }, play: async ({ canvas }) => { await expect(canvas.queryByText(translate('he', 'home.title'))).toBeNull(); } };
export const ArchiveEntry: Story = { args: { hasArchive: true }, play: async ({ canvas, args }) => { await expect(canvas.getByText(translate('he', 'home.empty'))).toBeVisible(); await userEvent.click(canvas.getByRole('button', { name: translate('he', 'home.archive') })); await expect(args.onArchive).toHaveBeenCalledOnce(); } };
export const RemoveConfirmation: Story = { decorators: [Story => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><Story /></SafeAreaProvider>], args: { providers: providers.slice(0, 2), removeName: providers[0]!.provider.name }, play: async ({ canvasElement, args }) => {
  const body = within(canvasElement.ownerDocument.body);
  await expect(body.getByText(translate('he', 'home.removeMessage'))).toBeVisible();
  await userEvent.click(body.getByRole('button', { name: translate('he', 'home.removeConfirm') })); await expect(args.onConfirmRemove).toHaveBeenCalledOnce();
  await userEvent.click(body.getByRole('button', { name: translate('he', 'home.removeKeep') })); await expect(args.onCancelRemove).toHaveBeenCalledOnce();
} };

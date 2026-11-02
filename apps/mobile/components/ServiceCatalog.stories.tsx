import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, userEvent, within } from 'storybook/test';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import type { Locale } from '@/src/i18n/messages';
import { ServiceCatalog } from './ServiceCatalog';
function CatalogPreview({ locale, empty = false, failed = false }: { locale: Locale; empty?: boolean; failed?: boolean }) {
  const [client] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, queryFn: () => failed ? Promise.reject(new Error('offline')) : new Promise(() => {}) } } });
    if (!failed) client.setQueryData(['provider', 'preview', 'services'], { services: empty ? [] : [{ id: 'example', name: locale === 'he' ? 'ייעוץ אישי' : 'Consultation', description: null, durationMinutes: 30, priceMinor: 1999, currency: 'ILS', active: true }, { id: 'paused', name: locale === 'he' ? 'שירות עונתי' : 'Seasonal service', description: null, durationMinutes: 45, priceMinor: null, currency: null, active: false }] });
    client.setQueryData(['provider', 'preview', 'staff'], { staff: [{ id: 'staff-preview', displayName: 'Alex', active: true }] });
    return client;
  });
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><LocalePreview locale={locale}><QueryClientProvider client={client}><View style={{ maxWidth: 600, padding: 16 }}><ServiceCatalog businessId="preview"/></View></QueryClientProvider></LocalePreview></SafeAreaProvider>;
}
const meta = { title: 'Provider/Service Catalog', component: CatalogPreview, args: { locale: 'he' } } satisfies Meta<typeof CatalogPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hebrew: Story = { play: async ({ canvas }) => {
  await expect(canvas.getByRole('heading', { name: 'קטלוג שירותים' })).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'הוספת שירות' })).toBeVisible();
  await expect(canvas.getByText('לא זמין לקביעה')).toBeVisible();
} };
export const English: Story = { args: { locale: 'en' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('heading', { name: 'Service Catalog' })).toBeVisible();
  // The form opens only from the header button; each card has only Edit and Delete.
  await expect(canvas.queryByLabelText('Service name', { exact: true })).toBeNull();
  await expect(canvas.getAllByRole('button', { name: 'Edit service' })).toHaveLength(2);
  await expect(canvas.queryByRole('button', { name: 'Archive' })).toBeNull();
  await expect(canvas.queryByRole('button', { name: 'Restore' })).toBeNull();
} };
export const AddForm: Story = { args: { locale: 'en' }, play: async ({ canvas, canvasElement }) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Add service' }));
  const dialog = within(within(canvasElement.ownerDocument.body).getByTestId('service-form'));
  await expect(dialog.getByLabelText('Service name', { exact: true })).toBeVisible();
  await expect(dialog.getByLabelText('Price', { exact: true })).toHaveStyle({ direction: 'ltr' });
  await expect(dialog.queryByRole('button', { name: 'ILS' })).toBeNull();
  await expect(dialog.getByText('Prices are in Israeli shekels (₪). Leave empty for price on request.')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Alex' })).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  await expect(canvas.queryByLabelText('Service name', { exact: true })).toBeNull();
} };
export const EditForm: Story = { args: { locale: 'en' }, play: async ({ canvas, canvasElement }) => {
  await userEvent.click(within(canvas.getByTestId('service-card-paused')).getByRole('button', { name: 'Edit service' }));
  const dialog = within(within(canvasElement.ownerDocument.body).getByTestId('service-form'));
  await expect(dialog.getByRole('switch', { name: 'Available for booking' })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeVisible();
} };
export const DeleteConfirmation: Story = { args: { locale: 'he' }, play: async ({ canvas }) => {
  const card = within(canvas.getByTestId('service-card-example'));
  await userEvent.click(card.getByRole('button', { name: 'מחיקה' }));
  const confirm = card.getByRole('button', { name: 'אישור' }), cancel = card.getByRole('button', { name: 'ביטול' });
  // Side by side: one row, same top edge.
  await expect(Math.abs(confirm.getBoundingClientRect().top - cancel.getBoundingClientRect().top)).toBeLessThan(1);
  await userEvent.click(cancel);
  await expect(card.getByRole('button', { name: 'מחיקה' })).toBeVisible();
} };
export const Empty: Story = { args: { locale: 'en', empty: true }, play: async ({ canvas }) => { await expect(canvas.getByText('No services yet. Press "Add service" to add your first one.')).toBeVisible(); } };
export const LoadFailed: Story = { args: { locale: 'en', failed: true }, play: async ({ canvas }) => {
  await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load your services. Check your connection and retry.');
  await expect(canvas.getByRole('button', { name: 'Add service' })).toHaveAttribute('aria-disabled', 'true');
} };

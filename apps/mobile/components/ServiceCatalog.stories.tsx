import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect } from 'storybook/test';
import { View } from 'react-native';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import type { Locale } from '@/src/i18n/messages';
import { ServiceCatalog } from './ServiceCatalog';
function CatalogPreview({ locale, empty = false }: { locale: Locale; empty?: boolean }) {
  const [client] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, queryFn: () => new Promise(() => {}) } } });
    client.setQueryData(['provider', 'preview', 'services'], { services: empty ? [] : [{ id: 'example', name: locale === 'he' ? 'ייעוץ אישי' : 'Consultation', description: null, durationMinutes: 30, priceMinor: 1999, currency: 'ILS', active: true }, { id: 'archived', name: locale === 'he' ? 'שירות קודם' : 'Previous service', description: null, durationMinutes: 45, priceMinor: null, currency: null, active: false }] });
    client.setQueryData(['provider', 'preview', 'staff'], { staff: [{ id: 'staff-preview', displayName: 'Alex', active: true }] });
    return client;
  });
  return <LocalePreview locale={locale}><QueryClientProvider client={client}><View style={{ maxWidth: 600, padding: 16 }}><ServiceCatalog businessId="preview"/></View></QueryClientProvider></LocalePreview>;
}
const meta = { title: 'Provider/Service Catalog', component: CatalogPreview, args: { locale: 'he' } } satisfies Meta<typeof CatalogPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hebrew: Story = { play: async ({ canvas }) => { await expect(canvas.getByRole('heading', { name: 'קטלוג שירותים' })).toBeVisible(); await expect(canvas.getByLabelText('מחיר', { exact: true })).toHaveStyle({ direction: 'ltr' }); } };
export const English: Story = { args: { locale: 'en' }, play: async ({ canvas }) => { await expect(canvas.getByRole('heading', { name: 'Service Catalog' })).toBeVisible(); await expect(canvas.getByRole('button', { name: 'Restore' })).toBeVisible(); await expect(canvas.getByRole('button', { name: 'ILS' })).toHaveAttribute('aria-pressed', 'true'); await expect(canvas.getByRole('checkbox', { name: 'Alex' })).toHaveAttribute('aria-checked', 'false'); } };
export const Empty: Story = { args: { locale: 'en', empty: true } };

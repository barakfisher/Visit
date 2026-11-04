import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import { translate, type Locale } from '@/src/i18n/messages';
import { BusinessProfileForm, type BusinessProfile } from './BusinessProfileForm';
function Preview({ locale, business }: { locale: Locale; business?: Partial<BusinessProfile> }) {
  const [client] = useState(() => new QueryClient());
  return <LocalePreview locale={locale}><QueryClientProvider client={client}><BusinessProfileForm business={{ id: 'preview', name: 'Neighborhood studio', slug: 'neighborhood-studio', timezone: 'Asia/Jerusalem', category: 'Wellness', location: 'Jerusalem', description: 'Public business details', contactPhone: '+972501234567', contactEmail: 'studio@example.test', approvalStatus: 'APPROVED', publishedAt: null, ...business }} /></QueryClientProvider></LocalePreview>;
}
const meta = { title: 'Provider/Business profile', component: Preview, args: { locale: 'en' } } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const English: Story = { play: async ({ canvas }) => { await expect(canvas.getByRole('textbox', { name: 'Business URL name (fixed)' })).toHaveProperty('readOnly', true); await expect(canvas.getByRole('textbox', { name: 'Public business phone' })).toHaveStyle({ direction: 'ltr' }); } };
export const Hebrew: Story = { args: { locale: 'he' }, play: async ({ canvas }) => { await expect(canvas.getByRole('textbox', { name: 'טלפון ציבורי של העסק' })).toHaveStyle({ direction: 'ltr' }); } };
export const InvalidContact: Story = { play: async ({ canvas }) => { const input = canvas.getByRole('textbox', { name: 'Public business phone' }); await userEvent.clear(input); await userEvent.type(input, '12345'); await expect(canvas.getByRole('button', { name: 'Save business details' })).toBeDisabled(); await expect(canvas.getByRole('alert')).toHaveTextContent('050-1234567'); } };
// A new business has no category: the field starts empty, saving waits for one and the preview shows no dangling separator.
export const NoCategoryHebrew: Story = { args: { locale: 'he', business: { category: null, contactPhone: null } }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('textbox', { name: 'קטגוריה' })).toHaveValue('');
  await expect(canvas.getByRole('button', { name: 'שמירת פרטי העסק' })).toBeDisabled();
  await expect(canvas.getByText('Jerusalem', { exact: true })).toBeInTheDocument();
  await expect(canvas.queryByText(/General|·/)).toBeNull();
} };
// Israeli owners type local numbers; the form accepts them and saves the international form.
export const IsraeliPhoneHebrew: Story = { args: { locale: 'he', business: { contactPhone: null } }, play: async ({ canvas }) => {
  const input = canvas.getByRole('textbox', { name: 'טלפון ציבורי של העסק' });
  await userEvent.type(input, '050-123 4567');
  await expect(canvas.queryByRole('alert')).toBeNull();
  await expect(canvas.getByRole('button', { name: 'שמירת פרטי העסק' })).toBeEnabled();
} };
// The pilot zone is fixed: it reads as its name in the viewer's language, never as an IANA id in a field that looks editable.
export const TimezoneHebrew: Story = { args: { locale: 'he' }, play: async ({ canvas }) => {
  await expect(canvas.getByTestId('business-timezone')).toHaveTextContent(translate('he', 'time.israel'));
  await expect(canvas.queryByRole('textbox', { name: translate('he', 'setup.timezone') })).toBeNull();
  await expect(canvas.queryByText('Asia/Jerusalem')).toBeNull();
} };

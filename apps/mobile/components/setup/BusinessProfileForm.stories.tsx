import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import type { Locale } from '@/src/i18n/messages';
import { BusinessProfileForm } from './BusinessProfileForm';
function Preview({ locale }: { locale: Locale }) {
  const [client] = useState(() => new QueryClient());
  return <LocalePreview locale={locale}><QueryClientProvider client={client}><BusinessProfileForm business={{ id: 'preview', name: 'Neighborhood studio', slug: 'neighborhood-studio', timezone: 'Asia/Jerusalem', category: 'Wellness', location: 'Jerusalem', description: 'Public business details', contactPhone: '+972501234567', contactEmail: 'studio@example.test', approvalStatus: 'APPROVED', publishedAt: null }} /></QueryClientProvider></LocalePreview>;
}
const meta = { title: 'Provider/Business profile', component: Preview, args: { locale: 'en' } } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const English: Story = { play: async ({ canvas }) => { await expect(canvas.getByRole('textbox', { name: 'Business URL name (fixed)' })).toHaveProperty('readOnly', true); await expect(canvas.getByRole('textbox', { name: 'Public business phone' })).toHaveStyle({ direction: 'ltr' }); } };
export const Hebrew: Story = { args: { locale: 'he' }, play: async ({ canvas }) => { await expect(canvas.getByRole('textbox', { name: 'טלפון ציבורי של העסק' })).toHaveStyle({ direction: 'ltr' }); } };
export const InvalidContact: Story = { play: async ({ canvas }) => { const input = canvas.getByRole('textbox', { name: 'Public business phone' }); await userEvent.clear(input); await userEvent.type(input, '0501234567'); await expect(canvas.getByRole('button', { name: 'Save business details' })).toBeDisabled(); await expect(canvas.getByRole('alert')).toHaveTextContent('international phone number'); } };

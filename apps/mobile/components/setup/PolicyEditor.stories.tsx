import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, userEvent } from 'storybook/test';
import { View } from 'react-native';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import type { Locale } from '@/src/i18n/messages';
import { PolicyEditor } from './PolicyEditor';
const policy = { minimumNoticeMinutes: 60, maximumAdvanceDays: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 1440, rescheduleCutoffMinutes: 1440 };
function PolicyPreview({ locale }: { locale: Locale }) {
  const [client] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, queryFn: () => new Promise(() => {}) } } });
    client.setQueryData(['provider', 'preview', 'setup-policy'], { policy, defaults: policy });
    return client;
  });
  return <LocalePreview locale={locale}><QueryClientProvider client={client}><View style={{ maxWidth: 600, padding: 16 }}><PolicyEditor businessId="preview" /></View></QueryClientProvider></LocalePreview>;
}
const meta = { title: 'Provider/Booking Policy', component: PolicyPreview, args: { locale: 'he' } } satisfies Meta<typeof PolicyPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hebrew: Story = { play: async ({ canvas }) => {
  await expect(canvas.getByLabelText('מועד אחרון לביטול (שעות מראש)', { exact: true })).toHaveValue('24');
  await expect(canvas.getByText('לקוחות יכולים לקבוע תור עד 60 דקות לפני שהוא מתחיל.')).toBeVisible();
  await expect(canvas.getByText('היומן פתוח לקביעה 60 ימים קדימה.')).toBeVisible();
} };
export const English: Story = { args: { locale: 'en' }, play: async ({ canvas }) => {
  await expect(canvas.getByLabelText('Reschedule cutoff (hours before)', { exact: true })).toHaveValue('24');
  const notice = canvas.getByLabelText('Latest booking before start (minutes)', { exact: true });
  await userEvent.clear(notice); await userEvent.type(notice, '0');
  await expect(canvas.getByText('Customers can book right up to the moment an appointment starts.')).toBeVisible();
  await expect(canvas.getByText('The calendar is open for booking 60 days ahead.')).toBeVisible();
} };

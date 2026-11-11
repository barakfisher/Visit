import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { AgendaAppointmentCard } from './AgendaAppointmentCard.component';
import { AppText } from './AppText';
import { translate } from '../src/i18n/messages';
import type { AgendaAppointment } from '../src/types/ProviderAgenda.types';

const he = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('he', key, values);
const booking = (patch: Partial<AgendaAppointment> = {}): AgendaAppointment => ({
  id: 'one', status: 'CONFIRMED', revision: 1, startsAt: '2026-11-10T08:15:00Z', endsAt: '2026-11-10T08:40:00Z',
  customer: { displayName: 'ברק דב', phone: '+972501234567', email: null }, service: { name: 'תספורת גבר + זקן' }, staff: { displayName: 'דנה' }, ...patch,
});
const meta = { globals: { locale: 'he' }, title: 'Provider/Agenda appointment card', component: AgendaAppointmentCard, args: {
  t: he, contact: fn(), booking: booking(), span: '10:15–10:40', lifecycle: <AppText>lifecycle actions</AppText>,
}, decorators: [Story => <View style={{ maxWidth: 390 }}><Story /></View>] } satisfies Meta<typeof AgendaAppointmentCard>;
export default meta;
type Story = StoryObj<typeof meta>;

// Folded, a card says when, who and what; a tap opens who serves it, how to reach the customer and the actions, and a second tap folds it.
export const Folded: Story = { play: async ({ canvas, args }) => {
  const toggle = canvas.getByRole('button', { name: /ברק דב/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(canvas.getByText('10:15–10:40')).toBeVisible(); await expect(canvas.getByText('תספורת גבר + זקן')).toBeVisible();
  await expect(canvas.queryByText('lifecycle actions')).toBeNull(); await expect(canvas.queryByText(/דנה/)).toBeNull();
  await userEvent.click(toggle);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(canvas.getByText('lifecycle actions')).toBeVisible(); await expect(canvas.getByText(/דנה · \+972501234567/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: he('dashboard.whatsapp') })); await expect(args.contact).toHaveBeenCalledWith('+972501234567', 'whatsapp');
  await userEvent.click(toggle);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await waitFor(() => expect(canvas.queryByText('lifecycle actions')).toBeNull());
} };
// A manual appointment without a name or phone falls back to its email on the folded card, and contact buttons say why they are off.
export const ManualWithoutPhone: Story = { args: { booking: booking({ source: 'MANUAL', manualReason: 'בקשה טלפונית', customer: { displayName: null, phone: null, email: 'guest@example.test' } }) }, play: async ({ canvas }) => {
  const toggle = canvas.getByRole('button', { name: /guest@example\.test/ });
  await userEvent.click(toggle);
  await expect(canvas.getByText(new RegExp(`${he('manual.tag')} · בקשה טלפונית`))).toBeVisible();
  await expect(canvas.getByRole('button', { name: he('dashboard.noPhoneCall') })).toBeDisabled();
} };
// A long name and service stay on one line each, so the card keeps its height.
export const LongHebrew: Story = { args: { booking: booking({ customer: { displayName: 'לקוחה עם שם פרטי ושם משפחה ארוכים מאוד לבדיקת תצוגה', phone: null, email: null }, service: { name: 'טיפול פנים מקיף כולל ניקוי עמוק, פילינג ומסכה מרגיעה' } }) } };

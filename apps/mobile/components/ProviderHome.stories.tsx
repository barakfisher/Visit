import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { ProviderHome } from './ProviderHome.component';
import { translate, type MessageKey } from '../src/i18n/messages';
const he = (key: MessageKey) => translate('he', key);
const next = { id: 'next', when: 'יום שני, 7 בדצמבר · 9:00', what: 'תספורת · דנה', note: '', error: '', busy: false, onOpen: fn(), onReschedule: fn(), onCancel: fn() };
const meta = { globals: { locale: 'he' }, title: 'Business/Page', component: ProviderHome, args: {
  t: (key, values) => translate('he', key, values), state: 'ready', onRetry: fn(), name: 'Dana Studio', listing: 'תל אביב · מספרה',
  appointmentsState: 'ready', onRetryAppointments: fn(), next, mineSummary: 'שני תורים קרובים', onBook: fn(), onMine: fn(),
  contacts: { phone: '+972501234567', email: 'dana@example.com', location: 'תל אביב' }, contactSummary: 'טלפון, מייל, כתובת', onCall: fn(), onWrite: fn(),
  description: '', services: [{ id: 'cut', name: 'תספורת', summary: '30 דקות · ₪80.00' }], hours: [{ days: 'א׳, ב׳, ג׳', hours: '09:00–17:00' }],
  panel: null, onPanel: fn(),
} } satisfies Meta<typeof ProviderHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithNextAppointment: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('heading', { name: 'Dana Studio' })).toBeVisible();
  // The whole card is the link: a tap on its text lands on it.
  const link = canvas.getByRole('link', { name: new RegExp(he('providerHome.next')) });
  const landsOnLink = () => { const text = canvas.getByText(he('providerHome.next')).getBoundingClientRect(); return link.contains(link.ownerDocument.elementFromPoint(text.x + text.width / 2, text.y + text.height / 2)); };
  // The card grows into place first (SmoothReveal), so the point is checked once it is there.
  await waitFor(() => expect(landsOnLink()).toBe(true));
  await userEvent.click(link); await expect(args.next?.onOpen).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: he('ui.reschedule') })); await expect(args.next?.onReschedule).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^${he('providerHome.book')}`) })); await expect(args.onBook).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^${he('providerHome.mine')}`) })); await expect(args.onMine).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^${he('providerHome.contact')}`) })); await expect(args.onPanel).toHaveBeenCalledWith('contact');
} };
export const NoAppointmentHere: Story = { args: { next: null, mineSummary: 'אין תורים קרובים' }, play: async ({ canvas }) => {
  await expect(canvas.queryByText(he('providerHome.next'))).toBeNull();
  await expect(canvas.getByRole('button', { name: new RegExp(`^${he('providerHome.mine')}.*${he('providerHome.mineNone')}`) })).toBeVisible();
} };
export const NoContactDetails: Story = { args: { contacts: null, contactSummary: '' }, play: async ({ canvas }) => {
  await expect(canvas.queryByRole('button', { name: new RegExp(`^${he('providerHome.contact')}`) })).toBeNull();
  await expect(canvas.getByRole('button', { name: new RegExp(`^${he('providerHome.about')}`) })).toBeVisible();
} };
export const ContactOpen: Story = { args: { panel: 'contact' }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('button', { name: new RegExp(`^${he('providerHome.contact')}`) })).toHaveAttribute('aria-expanded', 'true');
  await userEvent.click(canvas.getByRole('button', { name: he('providerHome.call') })); await expect(args.onCall).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: he('providerHome.write') })); await expect(args.onWrite).toHaveBeenCalledOnce();
} };
export const AboutOpen: Story = { args: { panel: 'about' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('heading', { name: he('providerHome.hours') })).toBeVisible();
  await expect(canvas.getByText('30 דקות · ₪80.00')).toBeVisible();
} };
export const SignedOut: Story = { args: { appointmentsState: 'hidden', next: null }, play: async ({ canvas }) => {
  await expect(canvas.queryByRole('button', { name: new RegExp(`^${he('providerHome.mine')}`) })).toBeNull();
} };
export const AppointmentsFailed: Story = { args: { appointmentsState: 'error', next: null }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(he('providerHome.appointmentsFailed'));
  await userEvent.click(canvas.getByRole('button', { name: he('common.retry') })); await expect(args.onRetryAppointments).toHaveBeenCalledOnce();
} };
export const Unavailable: Story = { args: { state: 'unavailable' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(he('providerHome.unavailable'));
  await expect(canvas.queryByRole('button')).toBeNull();
} };
export const Loading: Story = { args: { state: 'loading' }, play: async ({ canvas }) => {
  await expect(canvas.getByLabelText(he('common.loading'))).toBeInTheDocument();
  await expect(canvas.queryByRole('button')).toBeNull();
} };
export const CancelNext: Story = { play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: he('ui.cancel') })); await expect(args.next?.onCancel).toHaveBeenCalledOnce();
} };
export const LockedNext: Story = { args: { next: { ...next, onReschedule: undefined, onCancel: undefined, note: he('lifecycle.lockedBoth') } }, play: async ({ canvas }) => {
  await expect(canvas.queryByRole('button', { name: he('ui.reschedule') })).toBeNull();
  await expect(canvas.queryByRole('button', { name: he('ui.cancel') })).toBeNull();
  await expect(canvas.getByText(he('lifecycle.lockedBoth'))).toBeVisible();
} };
export const AboutNoHours: Story = { args: { panel: 'about', hours: [] }, play: async ({ canvas }) => {
  await expect(canvas.getByText(he('providerHome.noHours'))).toBeVisible();
} };
export const LoadFailed: Story = { args: { state: 'error' }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: he('common.retry') })); await expect(args.onRetry).toHaveBeenCalledOnce();
} };

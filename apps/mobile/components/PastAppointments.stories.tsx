import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { PastAppointments } from './PastAppointments.component';
import { translate } from '../src/i18n/messages';
import type { PastAppointmentItem } from '../src/types/PastAppointments.types';

const he = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('he', key, values);
const item = (id: string, status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW', day: number): PastAppointmentItem => ({
  id, service: 'תספורת', status: he(`lifecycle.${status}`), place: he('ui.provider', { provider: 'דנה · Dana Studio' }),
  when: he('ui.when', { date: `${day} בנוב׳ 2026`, time: '10:30' }), details: '30 דקות · ₪120',
  booking: {} as PastAppointmentItem['booking'],
});
const three = [item('one', 'COMPLETED', 9), item('two', 'CANCELLED', 4), item('three', 'NO_SHOW', 1)];
const meta = { globals: { locale: 'he' }, title: 'Appointments/Past appointments', component: PastAppointments, args: {
  t: he, locale: 'he', bootstrapping: false, signedOut: false, state: 'ready', appointments: three, hasMore: false, loadingMore: false, moreFailed: false, filter: null,
  onMore: fn(), onRetry: fn(), onOpen: fn(), onBack: fn(),
} } satisfies Meta<typeof PastAppointments>;
export default meta;
type Story = StoryObj<typeof meta>;

// Each card opens its appointment from anywhere on it, and says its status.
export const Listed: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('heading', { name: he('lifecycle.history') })).toBeVisible();
  const card = canvas.getByRole('link', { name: new RegExp(he('lifecycle.CANCELLED')) });
  await userEvent.click(card); await expect(args.onOpen).toHaveBeenCalledWith('two');
  await userEvent.click(canvas.getByRole('button', { name: he('details.back') })); await expect(args.onBack).toHaveBeenCalledOnce();
  await expect(args.onMore).not.toHaveBeenCalled();
} };
// Reaching the end of a list that has more asks for the next page, with no button to press.
export const AsksForMore: Story = { args: { hasMore: true }, play: async ({ args }) => { await waitFor(() => expect(args.onMore).toHaveBeenCalled()); } };
export const LoadingMore: Story = { args: { hasMore: true, loadingMore: true, onMore: fn() }, play: async ({ canvas }) => { await expect(canvas.getByLabelText(he('pastAppointments.loadingMore'))).toBeInTheDocument(); } };
// A failed next page keeps what is shown and offers to try that page again.
export const MoreFailed: Story = { args: { hasMore: true, moreFailed: true }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(he('pastAppointments.moreFailed'));
  await expect(canvas.getAllByRole('link')).toHaveLength(three.length);
  await userEvent.click(canvas.getByRole('button', { name: he('common.retry') })); await expect(args.onRetry).toHaveBeenCalledOnce();
} };
export const Loading: Story = { args: { state: 'loading', appointments: [] }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toHaveTextContent(he('common.loading')); } };
export const Failed: Story = { args: { state: 'error', appointments: [] }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(he('pastAppointments.loadFailed'));
  await userEvent.click(canvas.getByRole('button', { name: he('common.retry') })); await expect(args.onRetry).toHaveBeenCalledOnce();
} };
export const Empty: Story = { args: { appointments: [] }, play: async ({ canvas }) => { await expect(canvas.getByText(he('lifecycle.empty'))).toBeVisible(); } };
export const FilteredToBusiness: Story = { args: { filter: { name: 'Dana Studio', onClear: fn() } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByText(he('appointments.filtered', { name: 'Dana Studio' }))).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: he('appointments.showAll') })); await expect(args.filter?.onClear).toHaveBeenCalledOnce();
} };
export const English: Story = { globals: { locale: 'en' }, args: { t: (key, values) => translate('en', key, values), locale: 'en', appointments: [] }, play: async ({ canvas }) => { await expect(canvas.getByText(translate('en', 'lifecycle.empty'))).toBeVisible(); } };

import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import { translate, type Locale } from '@/src/i18n/messages';
import type { WeeklyHoursState } from '@/src/lib/WeeklyHours.hook';
import type { SchedulePreview } from '@/src/types/ScheduleEditor.types';
import { WeeklyHours } from './WeeklyHours';

const nine = { startLocal: '09:00', endLocal: '19:00' };
const week = [[nine], [{ startLocal: '08:00', endLocal: '12:00' }, { startLocal: '16:00', endLocal: '20:00' }], [nine], [nine], [nine], [], []];
const closedWeek = week.map(() => []);
const affected = { id: 'appointment', revision: 2, status: 'CONFIRMED', startsAt: '2027-03-15T10:00:00Z', endsAt: '2027-03-15T10:30:00Z', serviceName: 'Consultation', staffName: 'Specialist' };
const conflict: SchedulePreview = { token: 'preview', timezone: 'Asia/Jerusalem', canSave: false, affected: [affected] };

type Args = Omit<WeeklyHoursState, 't' | 'direction'> & { locale: Locale };
function HoursPreview({ locale, ...state }: Args) {
  const t: WeeklyHoursState['t'] = (key, values) => translate(locale, key, values);
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
    <LocalePreview locale={locale}><View style={{ maxWidth: 600, padding: 16 }}><WeeklyHours {...state} locale={locale} t={t} direction={locale === 'he' ? 'rtl' : 'ltr'} /></View></LocalePreview>
  </SafeAreaProvider>;
}
const meta = { title: 'Provider/Weekly hours', component: HoursPreview, args: {
  locale: 'en', staff: false, loading: false, failed: false, ready: true, week, inherited: false,
  formOpen: false, form: { days: [], closed: false, intervals: [{ startLocal: '09:00', endLocal: '17:00' }] }, errors: {}, preview: null, failure: '', saved: false, busy: false, canAddInterval: true,
  openEdit: fn(), cancelForm: fn(), save: fn(), followBusiness: fn(), retry: fn(), toggleDay: fn(), setClosed: fn(), setInterval: fn(), addInterval: fn(), removeInterval: fn(), when: () => '15 March · 12:00',
} } satisfies Meta<typeof HoursPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
/** Summary times sit in Unicode isolates (see `ltr`); compare the visible text without them. */
const plain = (element: HTMLElement) => element.textContent?.replace(/[\u2066-\u2069]/g, '');
const dialogOf = (element: HTMLElement) => within(within(element.ownerDocument.body).getByTestId('hours-form'));

export const Summary: Story = { play: async ({ canvas, args }) => {
  await expect(plain(canvas.getByTestId('hours-group-0-2-3-4'))).toBe('Sun, Tue, Wed, Thu: 09:00–19:00');
  await expect(plain(canvas.getByTestId('hours-group-1'))).toBe('Mon: 08:00–12:00 | 16:00–20:00');
  await expect(plain(canvas.getByTestId('hours-group-5-6'))).toBe('Fri, Sat: closed');
  // No form, Save or Reload on the page: editing happens only in the dialog.
  await expect(canvas.queryByTestId('hours-form')).toBeNull();
  await expect(canvas.queryByRole('button', { name: 'Save hours' })).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: 'Edit hours' }));
  await expect(args.openEdit).toHaveBeenCalled();
} };
export const HebrewSummary: Story = { args: { locale: 'he' }, globals: { locale: 'he' }, play: async ({ canvas }) => {
  await expect(plain(canvas.getByTestId('hours-group-5-6'))).toBe('ו׳, ש׳: סגור');
  await expect(canvas.getByRole('button', { name: 'עריכת שעות' })).toBeVisible();
} };
export const Empty: Story = { args: { week: closedWeek }, play: async ({ canvas }) => {
  await expect(canvas.getByText('No hours set yet. Customers cannot book until you add them.')).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Edit hours' })).toBeVisible();
} };
export const Loading: Story = { args: { ready: false, loading: true }, play: async ({ canvas }) => {
  await expect(canvas.getByLabelText('Loading…')).toBeVisible();
  await expect(canvas.queryByRole('button', { name: 'Edit hours' })).toBeNull();
} };
export const LoadFailed: Story = { args: { ready: false, failed: true }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent('Could not load the hours.');
  await expect(canvas.queryByRole('button', { name: 'Edit hours' })).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: 'Try again' })); await expect(args.retry).toHaveBeenCalled();
} };
export const Saved: Story = { args: { saved: true }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toHaveTextContent('Hours saved.'); } };
export const EditDialog: Story = { args: { formOpen: true, form: { days: [0, 3, 4], closed: false, intervals: [nine] } }, play: async ({ canvasElement, args }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('checkbox', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('checkbox', { name: 'Monday' })).toHaveAttribute('aria-checked', 'false');
  await expect(dialog.getByLabelText('Opening time 1', { exact: true })).toHaveValue('09:00');
  await expect(dialog.getByLabelText('Opening time 1', { exact: true })).toHaveStyle({ direction: 'ltr' });
  await userEvent.click(dialog.getByRole('checkbox', { name: 'Monday' })); await expect(args.toggleDay).toHaveBeenCalledWith(1);
  await userEvent.click(dialog.getByRole('button', { name: 'Add a time range' })); await expect(args.addInterval).toHaveBeenCalled();
  const save = dialog.getByRole('button', { name: 'Save hours' }), cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expect(Math.abs(save.getBoundingClientRect().top - cancel.getBoundingClientRect().top)).toBeLessThan(1);
  await userEvent.click(save); await expect(args.save).toHaveBeenCalled();
  await userEvent.click(cancel); await expect(args.cancelForm).toHaveBeenCalled();
} };
export const SplitDay: Story = { args: { formOpen: true, form: { days: [1], closed: false, intervals: week[1]! } }, play: async ({ canvasElement, args }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByLabelText('Closing time 2', { exact: true })).toHaveValue('20:00');
  await userEvent.click(dialog.getByRole('button', { name: 'Remove time range 2' })); await expect(args.removeInterval).toHaveBeenCalledWith(1);
} };
export const ClosedDays: Story = { args: { formOpen: true, form: { days: [5, 6], closed: true, intervals: [nine] } }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('switch', { name: 'Closed on these days' })).toBeChecked();
  await expect(dialog.queryByLabelText('Opening time 1', { exact: true })).toBeNull();
} };
export const ValidationErrors: Story = { args: { formOpen: true, form: { days: [], closed: false, intervals: [{ startLocal: '19:00', endLocal: '09:00' }, { startLocal: '9', endLocal: '' }] }, errors: { days: 'days', 'end.0': 'order', 'start.1': 'format' } }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByText('Choose at least one day.')).toBeVisible();
  await expect(dialog.getByText('The closing time must be after the opening time.')).toBeVisible();
  await expect(dialog.getByText('Use HH:mm, for example 09:00.')).toBeVisible();
} };
export const ConflictingAppointment: Story = { args: { formOpen: true, form: { days: [2], closed: true, intervals: [nine] }, preview: conflict }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByText('Consultation · Specialist')).toBeVisible();
  await expect(dialog.getByText('Existing appointment')).toBeVisible();
  await expect(dialog.getByText(/1 appointments or reservations fall outside these hours/)).toBeVisible();
} };
export const ActiveReservation: Story = { args: { formOpen: true, form: { days: [2], closed: true, intervals: [nine] }, preview: { ...conflict, affected: [{ ...affected, status: 'HELD' }] } }, play: async ({ canvasElement }) => {
  await expect(dialogOf(canvasElement).getByText('Active temporary reservation')).toBeVisible();
} };
export const SaveFailedKeepsDraft: Story = { args: { formOpen: true, form: { days: [0], closed: false, intervals: [nine] }, failure: 'hours.saveFailed' }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('alert')).toHaveTextContent('Could not save the hours.');
  await expect(dialog.getByLabelText('Opening time 1', { exact: true })).toHaveValue('09:00');
} };
export const Pending: Story = { args: { busy: true, formOpen: true, form: { days: [0], closed: false, intervals: [nine] } }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  for (const button of dialog.getAllByRole('button')) await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByLabelText('Opening time 1', { exact: true })).toHaveAttribute('readonly');
} };
export const StaffFollowsBusiness: Story = { args: { staff: true, inherited: true }, play: async ({ canvas }) => {
  await expect(canvas.getByText('Follows the business hours.')).toBeVisible();
  await expect(canvas.getByTestId('hours-group-0-2-3-4')).toBeVisible();
  await expect(canvas.queryByRole('button', { name: 'Follow business hours' })).toBeNull();
} };
export const StaffOwnHours: Story = { args: { staff: true, inherited: false }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Follow business hours' })); await expect(args.followBusiness).toHaveBeenCalled();
} };
export const StaffAllClosed: Story = { args: { staff: true, formOpen: true, form: { days: [0, 1, 2, 3, 4], closed: true, intervals: [nine] }, errors: { form: 'staffClosed' } }, play: async ({ canvasElement }) => {
  await expect(dialogOf(canvasElement).getByText(/A staff member cannot be closed every day/)).toBeVisible();
} };
export const HebrewDialog: Story = { args: { locale: 'he', formOpen: true, form: { days: [0, 3, 4], closed: false, intervals: week[1]! }, preview: { ...conflict, affected: [{ ...affected, serviceName: 'פגישת ייעוץ מקיפה ומעקב ארוך טווח עם צוות המומחים', staffName: 'מומחית ראשית' }] } }, globals: { locale: 'he' }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('button', { name: 'שמירת שעות' })).toBeVisible();
  await expect(dialog.getByLabelText('שעת פתיחה 1', { exact: true })).toHaveValue('08:00');
} };

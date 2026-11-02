import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import { translate, type Locale } from '@/src/i18n/messages';
import { emptyBlockForm, type BlockForm, type BlockFormErrors } from '@/src/lib/TimeBlocks';
import type { TimeBlocksState } from '@/src/lib/TimeBlocks.hook';
import type { BlockConflicts, TimeBlock } from '@/src/types/TimeBlocks.types';
import { TimeBlocks } from './TimeBlocks';

const holiday: TimeBlock = { id: 'holiday', startsAt: '2026-12-23T22:00:00.000Z', endsAt: '2026-12-26T22:00:00.000Z', allDay: true, reason: 'Hanukkah', staff: null, fromDate: '2026-12-24', toDate: '2026-12-26' };
const dentist: TimeBlock = { id: 'dentist', startsAt: '2026-11-10T08:00:00.000Z', endsAt: '2026-11-10T10:00:00.000Z', allDay: false, reason: null, staff: { id: 'noa', displayName: 'Noa' }, fromDate: '2026-11-10', toDate: '2026-11-10', startLocal: '10:00', endLocal: '12:00' };
const staff = [{ id: 'noa', displayName: 'Noa', active: true }, { id: 'dan', displayName: 'Dan', active: true }];
const conflicts: BlockConflicts = { total: 22, conflicts: [
  { kind: 'APPOINTMENT', id: 'a1', startsAt: '2026-12-24T08:00:00.000Z', endsAt: '2026-12-24T08:30:00.000Z', staffName: 'Noa', customerName: 'Dana Levi', serviceName: 'Haircut' },
  { kind: 'RESERVATION', startsAt: '2026-12-24T09:00:00.000Z', endsAt: '2026-12-24T09:30:00.000Z', staffName: 'Dan' },
] };

type Args = Omit<TimeBlocksState, 't' | 'locale' | 'direction' | 'dialog'> & {
  locale: Locale; dialogOpen: boolean; form: BlockForm; errors: BlockFormErrors; conflicts: BlockConflicts | null; failure: TimeBlocksState['dialog']['failure']; busy: boolean;
  update: TimeBlocksState['dialog']['update']; save: () => void; close: () => void;
};
function BlocksPreview({ locale, dialogOpen, form, errors, conflicts: listed, failure, busy, update, save, close, ...state }: Args) {
  const t: TimeBlocksState['t'] = (key, values) => translate(locale, key, values), direction = locale === 'he' ? 'rtl' as const : 'ltr' as const;
  const dialog: TimeBlocksState['dialog'] = { t, locale, direction, timezone: 'Asia/Jerusalem', open: dialogOpen, form, errors, conflicts: listed, failure, busy, ready: true, openDialog: fn(), close, update, save, when: () => '24 Dec 2026 · 10:00' };
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
    <LocalePreview locale={locale}><View style={{ maxWidth: 600, padding: 16 }}><TimeBlocks {...state} t={t} locale={locale} direction={direction} dialog={dialog} /></View></LocalePreview>
  </SafeAreaProvider>;
}
const meta = { title: 'Provider/Blocked time', component: BlocksPreview, args: {
  locale: 'en', blocks: [dentist, holiday], loading: false, failed: false, ready: true, staff, message: '', removing: null, pending: null, removeFailure: '',
  dialogOpen: false, form: emptyBlockForm('2026-12-24'), errors: {}, conflicts: null, failure: '', busy: false,
  askRemove: fn(), confirmRemove: fn(), retry: fn(), openDialog: fn(), update: fn(), save: fn(), close: fn(),
} } satisfies Meta<typeof BlocksPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
/** Times sit in Unicode isolates (see `ltr`); compare the visible text without them. */
const plain = (element: HTMLElement) => element.textContent?.replace(/[⁦-⁩]/g, '');
const dialogOf = (element: HTMLElement) => within(within(element.ownerDocument.body).getByTestId('block-form'));

export const List: Story = { play: async ({ canvas, args }) => {
  await expect(plain(canvas.getByTestId('time-block-dentist'))).toContain('Tue, 10 Nov 2026 · 10:00–12:00');
  await expect(canvas.getByTestId('time-block-dentist')).toHaveTextContent('Noa');
  await expect(plain(canvas.getByTestId('time-block-holiday'))).toContain('Thu, 24 Dec 2026 – Sat, 26 Dec 2026 · All day');
  await expect(canvas.getByTestId('time-block-holiday')).toHaveTextContent('Whole business · Hanukkah');
  await expect(canvas.queryByTestId('block-form')).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: 'Block time' })); await expect(args.openDialog).toHaveBeenCalled();
  await userEvent.click(within(canvas.getByTestId('time-block-holiday')).getByRole('button', { name: 'Remove block' })); await expect(args.askRemove).toHaveBeenCalledWith('holiday');
} };
export const HebrewList: Story = { args: { locale: 'he' }, globals: { locale: 'he' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('heading', { name: 'זמנים חסומים' })).toBeVisible();
  await expect(canvas.getByTestId('time-block-holiday')).toHaveTextContent('כל העסק · Hanukkah');
  await expect(canvas.getByTestId('time-block-holiday')).toHaveTextContent('כל היום');
  await expect(canvas.getByRole('button', { name: 'חסימת זמן' })).toBeVisible();
} };
export const Empty: Story = { args: { blocks: [] }, play: async ({ canvas }) => {
  await expect(canvas.getByText('No blocked time ahead.')).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Block time' })).toBeVisible();
} };
export const Loading: Story = { args: { blocks: [], ready: false, loading: true }, play: async ({ canvas }) => {
  await expect(canvas.getByLabelText('Loading…')).toBeVisible();
  await expect(canvas.queryByRole('button', { name: 'Block time' })).toBeNull();
} };
export const LoadFailed: Story = { args: { blocks: [], ready: false, failed: true }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent('Could not load blocked time.');
  await expect(canvas.queryByRole('button', { name: 'Block time' })).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: 'Try again' })); await expect(args.retry).toHaveBeenCalled();
} };
export const ConfirmRemove: Story = { args: { removing: 'holiday' }, play: async ({ canvas, args }) => {
  const row = within(canvas.getByTestId('time-block-holiday'));
  await expect(row.getByText('Remove this block? Customers will be able to book this time again.')).toBeVisible();
  const confirm = row.getByRole('button', { name: 'Confirm' }), cancel = row.getByRole('button', { name: 'Cancel' });
  await expect(Math.abs(confirm.getBoundingClientRect().top - cancel.getBoundingClientRect().top)).toBeLessThan(1);
  await userEvent.click(confirm); await expect(args.confirmRemove).toHaveBeenCalledWith('holiday');
  await userEvent.click(cancel); await expect(args.askRemove).toHaveBeenCalledWith(null);
} };
export const RemoveFailed: Story = { args: { removeFailure: 'blocks.removeFailed' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent('Could not remove the block. Try again.');
} };
export const Saved: Story = { args: { message: 'blocks.saved' }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toHaveTextContent('Time blocked.'); } };
export const HoursDialog: Story = { args: { dialogOpen: true }, play: async ({ canvasElement, args }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('radio', { name: 'Whole business' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio', { name: 'Hours on one day' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByLabelText('Date', { exact: true })).toHaveValue('2026-12-24');
  await expect(dialog.getByLabelText('From', { exact: true })).toHaveStyle({ direction: 'ltr' });
  await userEvent.click(dialog.getByRole('radio', { name: 'Noa' })); await expect(args.update).toHaveBeenCalledWith({ staffId: 'noa' });
  await userEvent.click(dialog.getByRole('radio', { name: 'Whole days' })); await expect(args.update).toHaveBeenCalledWith({ kind: 'days' });
  const save = dialog.getByRole('button', { name: 'Save block' }), cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expect(Math.abs(save.getBoundingClientRect().top - cancel.getBoundingClientRect().top)).toBeLessThan(1);
  await userEvent.click(save); await expect(args.save).toHaveBeenCalled();
  await userEvent.click(cancel); await expect(args.close).toHaveBeenCalled();
} };
export const DaysDialog: Story = { args: { dialogOpen: true, form: { ...emptyBlockForm('2026-12-24'), kind: 'days', staffId: 'dan', toDate: '2026-12-26', reason: 'Vacation' } }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('radio', { name: 'Dan' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByLabelText('First day', { exact: true })).toHaveValue('2026-12-24');
  await expect(dialog.getByLabelText('Last day', { exact: true })).toHaveValue('2026-12-26');
  await expect(dialog.queryByLabelText('From', { exact: true })).toBeNull();
  await expect(dialog.getByLabelText('Reason (optional)', { exact: true })).toHaveValue('Vacation');
} };
export const HebrewDialog: Story = { args: { locale: 'he', dialogOpen: true }, globals: { locale: 'he' }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('radio', { name: 'כל העסק' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'שמירת החסימה' })).toBeVisible();
} };
export const ValidationErrors: Story = { args: { dialogOpen: true, form: { ...emptyBlockForm('2026-12-24'), kind: 'days', fromDate: '2026-12-26', toDate: '2026-12-24', reason: 'x'.repeat(201) }, errors: { toDate: 'range', reason: 'reason' } }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByText('The last day cannot come before the first day.')).toBeVisible();
  await expect(dialog.getByText('Keep the reason to 200 characters.')).toBeVisible();
} };
export const Conflicts: Story = { args: { dialogOpen: true, conflicts }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('alert')).toHaveTextContent('22 appointments or reservations fall in this time, so nothing was saved.');
  await expect(dialog.getByText('24 Dec 2026 · 10:00 · Noa · Dana Levi · Haircut')).toBeVisible();
  await expect(dialog.getByText('24 Dec 2026 · 10:00 · Dan · Reservation in progress')).toBeVisible();
  await expect(dialog.getByText('And 20 more.')).toBeVisible();
  await expect(dialog.getByLabelText('Date', { exact: true })).toHaveValue('2026-12-24');
} };
export const SaveFailedKeepsDraft: Story = { args: { dialogOpen: true, failure: 'blocks.saveFailed', form: { ...emptyBlockForm('2026-12-24'), reason: 'Training' } }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  await expect(dialog.getByRole('alert')).toHaveTextContent('Could not save the block.');
  await expect(dialog.getByLabelText('Reason (optional)', { exact: true })).toHaveValue('Training');
} };
export const Pending: Story = { args: { dialogOpen: true, busy: true }, play: async ({ canvasElement }) => {
  const dialog = dialogOf(canvasElement);
  for (const button of dialog.getAllByRole('button')) await expect(button).toHaveAttribute('aria-disabled', 'true');
  for (const radio of dialog.getAllByRole('radio')) await expect(radio).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByLabelText('Date', { exact: true })).toHaveAttribute('readonly');
} };

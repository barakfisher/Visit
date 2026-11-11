import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { ManualBooking } from './ManualBooking.component';
import { compactControlsFixture } from './CompactBookingControls.fixture';
import { translate } from '../src/i18n/messages';
import { emptyManualDraft } from '../src/state/ManualBooking.store';
import type { CustomerCardSummary, ManualBookingView, ManualCustomerPicking, ManualSlotPicking } from '../src/types/ManualBooking.types';
const t: ManualBookingView['t'] = (key, values) => translate('en', key, values);
const draft = { ...emptyManualDraft, open: true, serviceId: 'service', staffId: 'staff', localDate: '2027-03-15', localTime: '09:00', utcOffset: '+02:00', customerName: 'New customer', customerPhone: '050-1234567' };
const options = { timezone: 'Asia/Jerusalem', bookable: true, services: [{ id: 'service', name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS', staff: [{ id: 'staff', displayName: 'Specialist', parallelCapacity: 1 }, { id: 'second', displayName: 'Second specialist', parallelCapacity: 1 }] }] };
const picking: ManualSlotPicking = { controls: compactControlsFixture, disabled: false, date: '2027-03-15', selectedId: 'staff:instant', slotLoading: false, slotError: false, onRetrySlots: fn(), onSelectSlot: fn(),
  staff: options.services[0]!.staff, staffFilter: '', onStaffFilter: fn(), slotLabel: '09:00 · Specialist' };
const customer: ManualCustomerPicking = { suggestions: [], searching: false, searchError: false, searched: false, phoneMatch: null, onRetrySearch: fn(), onPick: fn(), onClearPick: fn() };
const walkIn: CustomerCardSummary = { id: 'walk-in', name: 'Dana Levi', phone: '+972501234567', email: null, linked: false };
const appCustomer: CustomerCardSummary = { id: 'app', name: 'Dana Cohen', phone: null, email: 'dana@example.test', linked: true };
const meta = { title: 'Provider/Manual booking', component: ManualBooking, args: { customer, t, draft, options, picking, loading: false, loadError: false, busy: false, locked: false, feedback: '', success: false, serviceSummary: 'Consultation · 30 minutes · ₪100', update: fn(), retry: fn(), review: fn(), confirm: fn(), close: fn() },
  decorators: [Story => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><Story /></SafeAreaProvider>] } satisfies Meta<typeof ManualBooking>;
export default meta;
type Story = StoryObj<typeof meta>;
/** Service, date and time come from the customer's controls; only the customer is typed, and nothing asks for a UTC offset or a reason. */
export const Form: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByDisplayValue('New customer')).toBeVisible();
  await expect(canvas.getByText(t('manual.chosenTime', { time: '09:00 · Specialist' }))).toBeVisible();
  await expect(canvas.getAllByRole('textbox')).toHaveLength(3);
  await userEvent.click(canvas.getByRole('radio', { name: 'Second specialist' })); await expect(args.picking!.onStaffFilter).toHaveBeenCalledWith('second');
  await userEvent.click(canvas.getByRole('button', { name: t('manual.review') })); await expect(args.review).toHaveBeenCalled();
} };
export const OneStaffMember: Story = { args: { picking: { ...picking, staff: [options.services[0]!.staff[0]!] } }, play: async ({ canvas }) => { await expect(canvas.queryByRole('radiogroup', { name: t('manual.staff') })).toBeNull(); } };
export const Loading: Story = { args: { loading: true, options: undefined, picking: null }, play: async ({ canvas }) => { await expect(canvas.getByText(t('manual.loading'))).toBeVisible(); } };
export const Empty: Story = { args: { options: { ...options, services: [] }, picking: null }, play: async ({ canvas }) => { await expect(canvas.getByText(t('manual.empty'))).toBeVisible(); } };
export const Unpublished: Story = { args: { options: { ...options, bookable: false }, picking: null }, play: async ({ canvas }) => { await expect(canvas.getByText(t('manual.notBookable'))).toBeVisible(); } };
export const FailedLoad: Story = { args: { loadError: true, picking: null }, play: async ({ canvas, args }) => { await expect(canvas.getByRole('alert')).toHaveTextContent(t('manual.loadError')); await userEvent.click(canvas.getByRole('button', { name: t('common.retry') })); await expect(args.retry).toHaveBeenCalled(); } };
export const Review: Story = { args: { draft: { ...draft, reviewed: true } }, play: async ({ canvas, args }) => { await userEvent.click(canvas.getByRole('button', { name: t('manual.confirm') })); await expect(args.confirm).toHaveBeenCalled(); await expect(canvas.queryByRole('textbox')).toBeNull(); } };
export const Pending: Story = { args: { draft: { ...draft, reviewed: true }, busy: true, locked: true }, play: async ({ canvas }) => { for (const button of canvas.getAllByRole('button')) await expect(button).toBeDisabled(); } };
export const Uncertain: Story = { args: { draft: { ...draft, reviewed: true }, locked: true, feedback: 'Connection interrupted. Retry this same attempt.' }, play: async ({ canvas, args }) => { await expect(canvas.getByRole('button', { name: t('manual.edit') })).toBeDisabled(); await expect(canvas.getByRole('button', { name: t('manual.close') })).toBeDisabled(); await userEvent.click(canvas.getByRole('button', { name: t('manual.retry') })); await expect(args.confirm).toHaveBeenCalled(); } };
export const FailedSubmission: Story = { args: { feedback: 'Time unavailable. Choose another time.' }, play: async ({ canvas }) => { await expect(canvas.getByRole('alert')).toBeVisible(); await expect(canvas.getByDisplayValue('New customer')).toBeVisible(); } };
export const Success: Story = { args: { success: true, feedback: 'Appointment created. Contact remains unverified; no notification sent.' }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toBeVisible(); await expect(canvas.queryByRole('textbox')).toBeNull(); } };
export const HebrewReview: Story = { args: { t: (key, values) => translate('he', key, values), draft: { ...draft, reviewed: true, customerName: 'לקוחה חדשה עם שם מלא וארוך במיוחד לצורך בדיקת תצוגה' }, serviceSummary: 'פגישת ייעוץ מקיפה ומעקב ארוך טווח עם צוות המומחים' }, globals: { locale: 'he' } };

/** Typing a name suggests this business's own customers, each with a phone or, for an app customer, an email (criterion 1). */
export const CustomerSuggestions: Story = { args: { draft: { ...draft, customerName: 'Dana', customerPhone: '' }, customer: { ...customer, searched: true, suggestions: [walkIn, appCustomer] } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByTestId('manual-suggestions')).toHaveTextContent(t('manual.suggestions'));
  await expect(canvas.getByTestId('manual-suggestions')).toHaveTextContent('050-1234567'); await expect(canvas.getByTestId('manual-suggestions')).toHaveTextContent('dana@example.test'); await expect(canvas.getByText(t('manual.linked'))).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /Dana Levi/ })); await expect(args.customer.onPick).toHaveBeenCalledWith(walkIn);
} };
export const CustomerSearching: Story = { args: { draft: { ...draft, customerName: 'Dana' }, customer: { ...customer, searched: true, searching: true } }, play: async ({ canvas }) => { await expect(canvas.getByText(t('manual.searching'))).toBeVisible(); } };
export const NewCustomer: Story = { args: { draft: { ...draft, customerName: 'Noa' }, customer: { ...customer, searched: true } }, play: async ({ canvas }) => {
  await expect(canvas.getByText(t('manual.newCustomer'))).toBeVisible();
  await expect(canvas.getByRole('checkbox', { name: t('manual.save') })).toBeChecked();
} };
/** A failed search says so and still lets the business type the customer (criterion 12). */
export const SearchFailed: Story = { args: { draft: { ...draft, customerName: 'Dana' }, customer: { ...customer, searched: true, searchError: true } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(t('manual.searchError'));
  await expect(canvas.getAllByRole('textbox')).toHaveLength(3);
  await userEvent.click(canvas.getByRole('button', { name: t('common.retry') })); await expect(args.customer.onRetrySearch).toHaveBeenCalled();
  await userEvent.type(canvas.getByLabelText(t('manual.phone')), '5'); await expect(args.update).toHaveBeenCalled();
} };
/** A typed phone that already belongs to a customer offers that customer instead of a second card (criterion 3). */
export const PhoneMatch: Story = { args: { customer: { ...customer, phoneMatch: walkIn } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByText(t('manual.phoneMatch', { name: 'Dana Levi' }))).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: t('manual.useCustomer', { name: 'Dana Levi' }) })); await expect(args.customer.onPick).toHaveBeenCalledWith(walkIn);
} };
export const SaveOff: Story = { args: { draft: { ...draft, saveCustomer: false } }, play: async ({ canvas, args }) => {
  const box = canvas.getByRole('checkbox', { name: t('manual.save') }); await expect(box).not.toBeChecked();
  await userEvent.click(box); await expect(args.update).toHaveBeenCalledWith({ saveCustomer: true });
} };
/** A picked customer needs no typing; the phone comes from the card (criterion 2). */
export const PickedCustomer: Story = { args: { draft: { ...draft, customerCard: walkIn, customerName: 'Dana Levi', customerPhone: '050-1234567' } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByTestId('manual-picked-customer')).toHaveTextContent('Dana Levi');
  await expect(canvas.queryAllByRole('textbox')).toHaveLength(0); await expect(canvas.queryByRole('checkbox')).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: t('manual.changeCustomer') })); await expect(args.customer.onClearPick).toHaveBeenCalled();
} };
/** An app customer's card may have only an email; the booking still asks for a phone, which is not saved to the card. */
export const PickedAppCustomer: Story = { args: { draft: { ...draft, customerCard: appCustomer, customerName: 'Dana Cohen', customerPhone: '' } }, play: async ({ canvas }) => {
  await expect(canvas.getAllByRole('textbox')).toHaveLength(1); await expect(canvas.getByLabelText(t('manual.phone'))).toBeVisible();
} };
export const ReviewSavedCustomer: Story = { args: { draft: { ...draft, reviewed: true, customerCard: walkIn } }, play: async ({ canvas }) => { await expect(canvas.getByTestId('manual-review-customer')).toHaveTextContent(t('manual.reviewSaved')); } };
export const HebrewSuggestions: Story = { args: { t: (key, values) => translate('he', key, values), draft: { ...draft, customerName: 'דנה' }, customer: { ...customer, searched: true, suggestions: [{ ...walkIn, name: 'דנה לוי' }, { ...appCustomer, name: 'דנה כהן' }] } }, globals: { locale: 'he' } };

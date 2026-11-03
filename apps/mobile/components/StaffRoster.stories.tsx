import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, userEvent, within } from 'storybook/test';
import { translate } from '@/src/i18n/messages';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocalePreview } from '@/src/i18n/LocaleContext';
import type { Locale } from '@/src/i18n/messages';
import { useStaffRoster } from '@/src/lib/StaffRoster.hook';
import type { StaffRemovalConflicts } from '@/src/lib/StaffRoster';
import { AppText } from './AppText';
import { StaffRosterView } from './StaffRoster.component';

type Data = 'staff' | 'empty' | 'noServices' | 'failed';
function Roster({ conflicts }: { conflicts?: StaffRemovalConflicts }) {
  const state = useStaffRoster('preview', () => 'preview-key');
  return <StaffRosterView {...state} {...(conflicts ? { removing: 'noa', conflicts } : {})} hours={staffId => <AppText testID={`hours-${staffId}`}>WeeklyHours</AppText>} />;
}
function RosterPreview({ locale, data = 'staff', conflicts }: { locale: Locale; data?: Data; conflicts?: StaffRemovalConflicts }) {
  const [client] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, queryFn: () => data === 'failed' ? Promise.reject(new Error('offline')) : new Promise(() => {}) } } });
    if (data === 'failed') return client;
    const he = locale === 'he';
    const cut = { id: 'cut', name: he ? 'תספורת' : 'Haircut', active: data !== 'noServices' }, colour = { id: 'colour', name: he ? 'צבע' : 'Colour', active: false };
    client.setQueryData(['provider', 'preview', 'services'], { services: [cut, colour] });
    client.setQueryData(['me', null], { identity: { platformRole: 'USER', displayName: he ? 'דנה' : 'Dana' }, memberships: [], providerApplications: [] });
    client.setQueryData(['provider', 'preview', 'staff'], { staff: data !== 'staff' ? [] : [
      { id: 'noa', displayName: he ? 'נועה' : 'Noa', active: true, parallelCapacity: 2, services: [{ serviceId: 'cut', service: cut }, { serviceId: 'colour', service: colour }] },
      { id: 'dan', displayName: he ? 'דן' : 'Dan', active: false, parallelCapacity: 1, services: [{ serviceId: 'cut', service: cut }] },
    ] });
    return client;
  });
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><LocalePreview locale={locale}><QueryClientProvider client={client}><View style={{ maxWidth: 600, padding: 16 }}><Roster conflicts={conflicts} /></View></QueryClientProvider></LocalePreview></SafeAreaProvider>;
}
const meta = { title: 'Provider/Staff Roster', component: RosterPreview, args: { locale: 'he' } } satisfies Meta<typeof RosterPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Hebrew: Story = { play: async ({ canvas }) => {
  await expect(canvas.getByRole('heading', { name: 'אנשי הצוות' })).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'הוספת איש צוות' })).toBeVisible();
  const card = within(canvas.getByTestId('staff-card-noa'));
  await expect(card.getByText('תספורת')).toBeVisible();
  await expect(card.getByText('צבע')).toBeVisible();
  await expect(card.getByText('תורים במקביל: 2')).toBeVisible();
  await expect(within(canvas.getByTestId('staff-card-dan')).getByText('לא זמין לתורים חדשים')).toBeVisible();
} };
export const English: Story = { args: { locale: 'en' }, play: async ({ canvas }) => {
  // The form opens only from the header button; each card has one Edit and one Remove.
  await expect(canvas.queryByLabelText('Name', { exact: true })).toBeNull();
  const card = within(canvas.getByTestId('staff-card-noa'));
  await expect(card.getAllByRole('button')).toHaveLength(2);
  await expect(card.getByRole('button', { name: 'Edit Noa' })).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('button', { name: 'Remove Noa' })).toBeVisible();
  await expect(canvas.queryByText('Not available for new appointments', { exact: true })).toBeVisible();
} };
export const Empty: Story = { args: { locale: 'en', data: 'empty' }, play: async ({ canvas }) => {
  await expect(canvas.getByText('No staff members yet.')).toBeVisible();
  await expect(canvas.getByRole('button', { name: translate('en', 'roster.addSelf') })).toBeEnabled();
  await expect(canvas.getByRole('button', { name: 'Add staff member' })).toBeEnabled();
} };
export const AddMyself: Story = { args: { locale: 'he', data: 'empty' }, play: async ({ canvas, canvasElement }) => {
  await userEvent.click(canvas.getByRole('button', { name: translate('he', 'roster.addSelf') }));
  const dialog = within(canvasElement.ownerDocument.body);
  await expect(dialog.getByDisplayValue('דנה')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'תספורת' })).toBeChecked();
} };
export const NoServices: Story = { args: { locale: 'en', data: 'noServices' }, play: async ({ canvas }) => {
  await expect(canvas.getByText('Add an active service first, then add the staff members who provide it.')).toBeVisible();
  await expect(canvas.queryByRole('button', { name: 'Add staff member' })).toBeNull();
  await expect(canvas.queryByRole('button', { name: translate('en', 'roster.addSelf') })).toBeNull();
} };
export const LoadFailed: Story = { args: { locale: 'he', data: 'failed' }, play: async ({ canvas }) => {
  await expect(await canvas.findByRole('alert')).toHaveTextContent('לא הצלחנו לטעון את הצוות. בדקו את החיבור ונסו שוב.');
  await expect(canvas.getByRole('button', { name: 'ניסיון נוסף' })).toBeVisible();
} };
export const AddDialog: Story = { args: { locale: 'en' }, play: async ({ canvas, canvasElement }) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Add staff member' }));
  const dialog = within(within(canvasElement.ownerDocument.body).getByTestId('staff-add-form'));
  const capacity = dialog.getByLabelText('Simultaneous appointments', { exact: true });
  await userEvent.clear(capacity);
  await userEvent.type(capacity, 'a1b');
  await expect(capacity).toHaveValue('1');
  await expect(capacity).toHaveStyle({ direction: 'ltr' });
  await expect(dialog.queryByRole('switch')).toBeNull();
  await expect(dialog.queryByRole('checkbox', { name: 'Colour' })).toBeNull();
  await userEvent.click(dialog.getByRole('button', { name: 'Add staff member' }));
  await expect(dialog.getByText('Enter a name of 2 to 120 characters.')).toBeVisible();
  await expect(dialog.getByText('Choose at least one service.')).toBeVisible();
  await userEvent.clear(capacity);
  await userEvent.click(dialog.getByRole('button', { name: 'Add staff member' }));
  await expect(dialog.getByText('Enter a whole number from 1 to 100.')).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  await expect(within(canvasElement.ownerDocument.body).queryByTestId('staff-add-form')).toBeNull();
} };
export const EditGeneral: Story = { args: { locale: 'he' }, play: async ({ canvas }) => {
  const card = within(canvas.getByTestId('staff-card-dan'));
  const edit = card.getByRole('button', { name: 'עריכה: דן' });
  await userEvent.click(edit);
  await expect(edit).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('tab', { name: 'כללי' })).toHaveAttribute('aria-selected', 'true');
  await expect(card.getByRole('tab', { name: 'שעות' })).toHaveAttribute('aria-selected', 'false');
  await expect(card.getByLabelText('שם', { exact: true })).toHaveValue('דן');
  await expect(card.getByRole('switch', { name: 'זמין לתורים חדשים' })).not.toBeChecked();
  await expect(card.getByText('כשהמתג כבוי, לקוחות לא יכולים לקבוע עם דן. תורים שכבר נקבעו נשארים.')).toBeVisible();
  await userEvent.click(card.getByRole('tab', { name: 'שעות' }));
  await expect(card.getByTestId('hours-dan')).toBeVisible();
  await expect(card.queryByLabelText('שם', { exact: true })).toBeNull();
  await userEvent.click(edit);
  await expect(card.queryByRole('tab', { name: 'כללי' })).toBeNull();
} };
export const RemoveConfirmation: Story = { args: { locale: 'he' }, play: async ({ canvas }) => {
  const card = within(canvas.getByTestId('staff-card-noa'));
  await userEvent.click(card.getByRole('button', { name: 'הסרה: נועה' }));
  await expect(card.getByText(/להסיר את נועה\?/)).toBeVisible();
  const confirm = card.getByRole('button', { name: 'אישור' }), cancel = card.getByRole('button', { name: 'ביטול' });
  // Side by side: one row, same top edge.
  await expect(Math.abs(confirm.getBoundingClientRect().top - cancel.getBoundingClientRect().top)).toBeLessThan(1);
  await userEvent.click(cancel);
  await expect(card.getByRole('button', { name: 'הסרה: נועה' })).toBeVisible();
} };
// The server caps the list and reports the exact total; the rest is counted, not listed.
const listed = [1, 2], total = 22;
const conflict = (index: number) => ({ kind: 'APPOINTMENT' as const, id: `b${index}`, startsAt: `2026-11-${String(10 + index).padStart(2, '0')}T08:00:00.000Z`, endsAt: `2026-11-${String(10 + index).padStart(2, '0')}T08:30:00.000Z`, staffName: 'Noa', customerName: 'Dana', serviceName: 'Haircut' });
export const RemoveRefused: Story = { args: { locale: 'en', conflicts: { total, timezone: 'Asia/Jerusalem', conflicts: listed.map(conflict) } }, play: async ({ canvas }) => {
  const list = within(canvas.getByTestId('staff-conflicts'));
  await expect(list.getByRole('alert')).toHaveTextContent(`${total} upcoming appointments are with this staff member, so nothing was removed.`);
  await expect(list.getAllByText(/Dana · Haircut/)).toHaveLength(listed.length);
  await expect(list.getByText(`And ${total - listed.length} more.`)).toBeVisible();
  await expect(within(canvas.getByTestId('staff-card-noa')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
} };

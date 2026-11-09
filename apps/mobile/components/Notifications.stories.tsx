import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { Notifications } from './Notifications.component';
import { NotificationBell } from './NotificationBell.component';
import { translate, type Locale } from '../src/i18n/messages';
import { notificationRow } from '../src/lib/Notifications.utils';
import type { InboxNotification } from '../src/types/Notifications.types';
const business = { id: 'business-1', name: 'סטודיו דנה לעיצוב שיער וטיפוח עם שם ארוך במיוחד', timezone: 'Asia/Jerusalem' };
const booking = { id: 'booking-1', startsAt: '2026-11-20T08:00:00.000Z', endsAt: '2026-11-20T08:30:00.000Z', previousStartsAt: null, serviceName: 'תספורת', customerName: 'נועה לוי' };
const inbox: InboxNotification[] = [
  { id: 'cancelled', kind: 'BOOKING_CANCELLED', audience: 'BUSINESS', createdAt: '2026-11-09T08:00:00.000Z', read: false, business, booking },
  { id: 'approved', kind: 'BUSINESS_APPROVED', audience: 'BUSINESS', createdAt: '2026-11-09T07:00:00.000Z', read: false, business, booking: null },
  { id: 'moved', kind: 'BOOKING_RESCHEDULED', audience: 'CUSTOMER', createdAt: '2026-11-08T07:00:00.000Z', read: true, business, booking: { ...booking, customerName: null, previousStartsAt: '2026-11-19T08:00:00.000Z' } },
  { id: 'rejected', kind: 'BUSINESS_REJECTED', audience: 'CUSTOMER', createdAt: '2026-11-07T07:00:00.000Z', read: true, business, booking: null },
];
const rows = (locale: Locale) => inbox.map(item => notificationRow(item, locale, !item.read));
const meta = { globals: { locale: 'he' }, title: 'Notifications/Screen', component: Notifications, args: {
  t: (key, values) => translate('he', key, values), bootstrapping: false, signedOut: false, state: 'ready', rows: [], openingId: null, openError: null, onOpen: fn(), onRetry: fn(),
} } satisfies Meta<typeof Notifications>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { play: async ({ canvas }) => { await expect(canvas.getByText(translate('he', 'notifications.empty'))).toBeVisible(); } };
export const Loading: Story = { args: { state: 'loading' }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toHaveTextContent(translate('he', 'notifications.loading')); } };
export const Failed: Story = { args: { state: 'error' }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(translate('he', 'notifications.failure'));
  await userEvent.click(canvas.getByRole('button', { name: translate('he', 'common.retry') })); await expect(args.onRetry).toHaveBeenCalledOnce();
} };
export const Listed: Story = { args: { rows: rows('he') }, play: async ({ canvas, args }) => {
  await expect(canvas.getAllByText(translate('he', 'notifications.new'))).toHaveLength(2);
  await userEvent.click(canvas.getByRole('button', { name: new RegExp(translate('he', 'notifications.approved.action')) }));
  await expect(args.onOpen).toHaveBeenCalledWith(args.rows[1]);
} };
export const English: Story = { args: { t: (key, values) => translate('en', key, values), rows: rows('en') }, globals: { locale: 'en' } };
export const AccessLost: Story = { args: { rows: rows('he'), openError: 'nav.changed' }, play: async ({ canvas }) => { await expect(canvas.getByRole('alert')).toHaveTextContent(translate('he', 'nav.changed')); } };
export const Bell: StoryObj<typeof NotificationBell> = { render: args => <NotificationBell {...args} />, args: { label: translate('he', 'notifications.bell.other', { count: '99+' }), badge: '99+', onPress: fn() }, play: async ({ canvas }) => { await expect(canvas.getByTestId('notification-badge')).toHaveTextContent('99+'); } };
export const BellQuiet: StoryObj<typeof NotificationBell> = { render: args => <NotificationBell {...args} />, args: { label: 'התראות', badge: null, onPress: fn() }, play: async ({ canvas }) => { await expect(canvas.queryByTestId('notification-badge')).toBeNull(); } };

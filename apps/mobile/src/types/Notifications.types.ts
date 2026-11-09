import type { useAppLocale } from '../i18n/LocaleContext';

export type NotificationKind = 'BOOKING_CONFIRMED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED' | 'BOOKING_COMPLETED' | 'BOOKING_NO_SHOW' | 'BUSINESS_APPROVED' | 'BUSINESS_REJECTED';

/** What happened, as the API says it. The wording is built here when read, so it follows the current language. */
export type InboxNotification = {
  id: string;
  kind: NotificationKind;
  audience: 'CUSTOMER' | 'BUSINESS';
  createdAt: string;
  read: boolean;
  business: { id: string; name: string; timezone: string };
  booking: { id: string; startsAt: string; endsAt: string; previousStartsAt: string | null; serviceName: string; customerName: string | null } | null;
};

export type NotificationTarget = { to: 'appointment'; bookingId: string } | { to: 'business'; businessId: string; date?: string } | { to: 'application' };

/** One row of the page, worded in the current language. */
export type NotificationRow = {
  id: string;
  title: string;
  businessName: string;
  lines: string[];
  action: string | null;
  received: string;
  isNew: boolean;
  target: NotificationTarget;
};

export type NotificationsView = {
  t: ReturnType<typeof useAppLocale>['t'];
  bootstrapping: boolean;
  signedOut: boolean;
  state: 'loading' | 'error' | 'ready';
  rows: NotificationRow[];
  openingId: string | null;
  openError: 'nav.changed' | 'notifications.openFailure' | null;
  onOpen: (row: NotificationRow) => void;
  onRetry: () => void;
};

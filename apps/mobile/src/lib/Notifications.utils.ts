import { translate, type Locale, type MessageKey } from '../i18n/messages';
import { translateCount } from '../i18n/plural';
import { appointmentDate, appointmentDay, appointmentSpan, appointmentTime, localDate } from './appointmentTime';
import type { InboxNotification, NotificationRow, NotificationTarget } from '../types/Notifications.types';

/** Above this the circle stops counting: it has room for three characters. */
export const MAX_BADGE_COUNT = 99;
export const notificationsKey = (identity: string | null) => ['notifications', identity] as const;
export const unreadKey = (identity: string | null) => [...notificationsKey(identity), 'unread'] as const;
export const notificationListKey = (identity: string | null) => [...notificationsKey(identity), 'list'] as const;
export const isNotificationQuery = (key: readonly unknown[]) => key[0] === 'notifications';

export const badgeText = (unread: number) => unread > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(unread);
/** Says what the circle shows, so the name of the button includes its visible text. */
export const bellLabel = (locale: Locale, unread: number) => unread > 0 ? translateCount(locale, 'notifications.bell', unread, { count: badgeText(unread) }) : translate(locale, 'notifications.bell');

/** A failed read keeps its old answer in the cache, and an old count would be a false alarm. */
export const circleText = (unread: number | undefined, readFailed: boolean) => !readFailed && unread ? badgeText(unread) : null;

/**
 * The rows to name in a mark, or null when none is needed. The first read always marks, even with every row shown
 * already read: unread rows can sit below the list's limit, where nothing else would ever clear them.
 */
export function rowsToMark(notifications: readonly InboxNotification[], sent: ReadonlySet<string>, marked: boolean) {
  if (!notifications.length || (marked && !notifications.some(item => !item.read && !sent.has(item.id)))) return null;
  return notifications.map(item => item.id);
}

/** The agenda's days are the business's, not the device's. */
export function notificationTarget(item: InboxNotification): NotificationTarget {
  if (item.kind === 'BUSINESS_REJECTED') return { to: 'application' };
  if (!item.booking) return { to: 'business', businessId: item.business.id };
  if (item.audience === 'CUSTOMER') return { to: 'appointment', bookingId: item.booking.id };
  return { to: 'business', businessId: item.business.id, date: localDate(item.business.timezone, new Date(item.booking.startsAt)) };
}

export function notificationRow(item: InboxNotification, locale: Locale, isNew: boolean): NotificationRow {
  const { booking, business } = item, timezone = business.timezone;
  const title = translate(locale, `notifications.kind.${item.kind}` as MessageKey);
  const lines = booking ? [
    booking.serviceName, appointmentSpan(booking.startsAt, booking.endsAt, timezone, locale, true),
    // A cancellation also has a previous time, the same one, and a move may change only the staff member.
    ...(item.kind === 'BOOKING_RESCHEDULED' && booking.previousStartsAt && booking.previousStartsAt !== booking.startsAt ? [translate(locale, 'notifications.previous', { when: `${appointmentDate(booking.previousStartsAt, timezone, locale)} · ${appointmentTime(booking.previousStartsAt, timezone, locale)}` })] : []),
    ...(booking.customerName ? [booking.customerName] : []),
  ].filter(Boolean) : [translate(locale, item.kind === 'BUSINESS_APPROVED' ? 'notifications.approved.body' : 'notifications.rejected.body')];
  const action = item.kind === 'BUSINESS_APPROVED' ? translate(locale, 'notifications.approved.action') : null;
  const received = `${appointmentDay(item.createdAt, timezone, locale)} · ${appointmentTime(item.createdAt, timezone, locale)}`;
  return { id: item.id, title, businessName: business.name, lines, action, received, isNew, target: notificationTarget(item) };
}

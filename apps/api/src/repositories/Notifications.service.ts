import { prisma } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MANAGING_ROLES } from '../security/tenant-context.js';

export const NOTIFICATION_LIST_LIMIT = 50;
/** The most `markNotificationsRead` accepts: what one list can show. */
export const NOTIFICATION_READ_LIMIT = NOTIFICATION_LIST_LIMIT;

/**
 * A business notification is readable only while its reader still manages that business, so losing access hides
 * it at once, with nothing to clean up. A customer's own notification follows the person, not the business.
 */
function visibleTo(identityId: string): Prisma.NotificationWhereInput {
  return { identityId, OR: [
    { audience: 'CUSTOMER' },
    { audience: 'BUSINESS', business: { deletedAt: null, approvalStatus: 'APPROVED', memberships: { some: { identityId, status: 'ACTIVE', role: { in: [...MANAGING_ROLES] } } } } },
  ] };
}

export const countUnreadNotifications = (identityId: string) => prisma.notification.count({ where: { ...visibleTo(identityId), readAt: null } });

export async function readNotifications(identityId: string) {
  const rows = await prisma.notification.findMany({ where: visibleTo(identityId), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: NOTIFICATION_LIST_LIMIT, select: {
    id: true, kind: true, audience: true, createdAt: true, readAt: true, bookingId: true,
    business: { select: { id: true, name: true, timezone: true } },
    event: { select: { newStartsAt: true, newEndsAt: true, oldStartsAt: true, booking: { select: { serviceName: true, customerName: true } } } },
  } });
  // The wording is the client's, in the reader's language; this only says what happened.
  return rows.map(row => ({
    id: row.id, kind: row.kind, audience: row.audience, createdAt: row.createdAt, read: !!row.readAt, business: row.business,
    booking: row.event && row.bookingId ? { id: row.bookingId, startsAt: row.event.newStartsAt, endsAt: row.event.newEndsAt, previousStartsAt: row.event.oldStartsAt, serviceName: row.event.booking.serviceName, customerName: row.audience === 'BUSINESS' ? row.event.booking.customerName : null } : null,
  }));
}

/**
 * Marks what the person was shown, and, when the list was full, whatever its limit left below. Naming rows rather
 * than a time means a notification that commits after the list was read stays unread: a transaction's `createdAt` is
 * its start. Rows the person cannot see now stay as they are, so regaining access shows them as unread.
 */
export async function markNotificationsRead(identityId: string, ids: readonly string[]) {
  const shown = { id: { in: [...ids] } };
  const oldest = ids.length < NOTIFICATION_LIST_LIMIT ? null : await prisma.notification.findFirst({ where: { identityId, ...shown }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  await prisma.notification.updateMany({ where: { AND: [visibleTo(identityId), { readAt: null }, oldest ? { OR: [shown, { createdAt: { lte: oldest.createdAt } }] } : shown] }, data: { readAt: new Date() } });
}

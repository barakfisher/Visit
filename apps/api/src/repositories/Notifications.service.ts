import { prisma } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { seesWholeBusinessWhere } from '../security/tenant-context.js';

export const NOTIFICATION_LIST_LIMIT = 50;
/** The most `markNotificationsRead` accepts: what one list can show. */
export const NOTIFICATION_READ_LIMIT = NOTIFICATION_LIST_LIMIT;

/** What a worker hears about their own calendar (decisions.md, "Worker notifications"); outcomes are theirs to mark. The trigger writes the same list. */
export const WORKER_NOTIFICATION_KINDS: readonly string[] = Object.freeze(['BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED']);

const liveBusiness = { deletedAt: null, approvalStatus: 'APPROVED' } satisfies Prisma.BusinessWhereInput;

/**
 * A business notification is readable only while its reader still manages that business, so losing access hides
 * it at once, with nothing to clean up. A worker reads one only while linked to a live row the booking was on or
 * moved to: unlinking, archiving the row or relinking to another row hides it the same way.
 * A customer's own notification follows the person, not the business.
 */
async function visibleTo(identityId: string): Promise<Prisma.NotificationWhereInput> {
  const calendars = await prisma.membership.findMany({ where: { identityId, status: 'ACTIVE', staffId: { not: null }, staff: { is: { archivedAt: null } }, business: liveBusiness }, select: { businessId: true, staffId: true } });
  return { identityId, OR: [
    { audience: 'CUSTOMER' },
    { audience: 'BUSINESS', business: { ...liveBusiness, memberships: { some: { identityId, status: 'ACTIVE', ...seesWholeBusinessWhere } } } },
    ...calendars.map(({ businessId, staffId }) => ({ audience: 'BUSINESS', businessId, kind: { in: [...WORKER_NOTIFICATION_KINDS] }, event: { OR: [{ newStaffId: staffId! }, { oldStaffId: staffId! }] } })),
  ] };
}

export const countUnreadNotifications = async (identityId: string) => prisma.notification.count({ where: { ...await visibleTo(identityId), readAt: null } });

export async function readNotifications(identityId: string) {
  const rows = await prisma.notification.findMany({ where: await visibleTo(identityId), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: NOTIFICATION_LIST_LIMIT, select: {
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
  const shown = { id: { in: [...ids] } }, visible = await visibleTo(identityId);
  const oldest = ids.length < NOTIFICATION_LIST_LIMIT ? null : await prisma.notification.findFirst({ where: { AND: [visible, shown] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  await prisma.notification.updateMany({ where: { AND: [visible, { readAt: null }, oldest ? { OR: [shown, { createdAt: { lte: oldest.createdAt } }] } : shown] }, data: { readAt: new Date() } });
}

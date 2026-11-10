import { prisma } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { bookingServiceSnapshot } from './bookings.js';
import { presentedStatus } from './AppointmentOutcome.utils.js';

/** How many past appointments one page carries: a phone screen and a half, so the next page loads before it is needed. */
export const HISTORY_PAGE_SIZE = 20;
const CURSOR_SEPARATOR = '|';

type HistoryCursor = { startsAt: Date; id: string };
// Opaque to the app: the last row's start and id, so a page continues exactly after it even when starts tie.
export function encodeHistoryCursor({ startsAt, id }: HistoryCursor) {
  return Buffer.from(`${startsAt.toISOString()}${CURSOR_SEPARATOR}${id}`).toString('base64url');
}
export function decodeHistoryCursor(cursor: string): HistoryCursor {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = text.indexOf(CURSOR_SEPARATOR);
  const startsAt = new Date(text.slice(0, split)), id = text.slice(split + 1);
  if (split < 1 || !id || Number.isNaN(+startsAt) || encodeHistoryCursor({ startsAt, id }) !== cursor) throw new AppError(400, 'INVALID_CURSOR', 'The history page cursor is not valid.');
  return { startsAt, id };
}

/**
 * The customer's past appointments, newest first, a page at a time. "Past" is everything My appointments does not list
 * as upcoming: the same rule as `listActiveCustomerBookings` (confirmed and not yet started), applied here so the two
 * lists never overlap and the app needs not filter.
 */
export async function listCustomerHistory(session: AuthenticatedSession, { cursor, businessId }: { cursor?: string | undefined; businessId?: string | undefined }) {
  await validateAuthenticatedSession(session);
  const after = cursor ? decodeHistoryCursor(cursor) : null, now = new Date();
  const rows = await prisma.booking.findMany({
    where: {
      customerId: session.identity.id,
      status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] },
      events: { some: {} },
      ...(businessId ? { businessId } : {}),
      AND: [
        { NOT: { status: 'CONFIRMED', startsAt: { gte: now } } },
        ...(after ? [{ OR: [{ startsAt: { lt: after.startsAt } }, { startsAt: after.startsAt, id: { lt: after.id } }] }] : []),
      ],
    },
    include: { business: { select: { id: true, name: true, timezone: true } }, staff: { select: { displayName: true } } },
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: HISTORY_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, HISTORY_PAGE_SIZE), last = page.at(-1);
  return {
    bookings: page.map(booking => ({ ...booking, status: presentedStatus(booking, +now), service: bookingServiceSnapshot(booking) })),
    nextCursor: rows.length > HISTORY_PAGE_SIZE && last ? encodeHistoryCursor(last) : null,
  };
}

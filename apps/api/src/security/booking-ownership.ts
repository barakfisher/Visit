import type { Prisma } from '../generated/prisma/client.js';

/**
 * The one rule for which appointments a signed-in person may read and act on as their customer: the
 * bookings they made themselves, and the bookings of a business's customer card linked to them
 * (customer-cards.md). `customerId` stays immutable; linking or unlinking a card is what moves a
 * business-entered booking into or out of someone's app.
 *
 * Holds and booking attempts are not appointments yet and stay with the person who created them
 * (`customerId`), so the booking flow in `routes/screen-flows.ts` and `routes/bookings.ts` does not use this.
 */
export function customerOwnedBookingWhere(identityId: string) {
  // An empty id would turn the card branch into "any booking with a card".
  if (!identityId) throw new Error('A customer scope needs an identity.');
  // Only business-entered bookings come through a card: an app booking is its booker's alone, whatever card it is on.
  return { OR: [{ customerId: identityId }, { source: 'MANUAL', customerCard: { is: { identityId } } }] } satisfies Prisma.BookingWhereInput;
}

/**
 * Row-locks one booking for a customer action, only when the same rule grants it. The card is locked
 * FOR SHARE so an unlink waits for, or is seen by, the action in progress.
 */
export async function lockCustomerOwnedBooking(tx: Prisma.TransactionClient, bookingId: string, identityId: string) {
  if (!identityId) throw new Error('A customer scope needs an identity.');
  await tx.$queryRaw`SELECT id FROM "CustomerCard" WHERE "identityId" = ${identityId} AND id = (SELECT "customerCardId" FROM "Booking" WHERE id = ${bookingId}) FOR SHARE`;
  await tx.$queryRaw`SELECT b.id FROM "Booking" b WHERE b.id = ${bookingId} AND (b."customerId" = ${identityId} OR b.source = 'MANUAL' AND EXISTS (SELECT 1 FROM "CustomerCard" c WHERE c."businessId" = b."businessId" AND c.id = b."customerCardId" AND c."identityId" = ${identityId})) FOR UPDATE OF b`;
}

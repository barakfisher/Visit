import { z } from 'zod';
import { CUSTOMER_SEARCH_MIN_DIGITS, customerSearchKind } from '@visit/contracts';
import type { CustomerCard, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { requireBusinessMembership } from '../security/tenant-context.js';

/** Suggestions one search returns: enough to tell same-named customers apart on a phone screen. */
export const CUSTOMER_CARD_SUGGESTIONS = 8;
export const CUSTOMER_CARD_EXISTS = 'CUSTOMER_CARD_EXISTS';

export const customerCardSearchSchema = z.strictObject({ q: z.string().trim().max(120) });

/** What the business sees of a card: its own typed contacts, or for an app customer only what their bookings already gave it. */
export function customerCardSummary(card: Pick<CustomerCard, 'id' | 'name' | 'phone' | 'email' | 'identityId'>) {
  return { id: card.id, name: card.name, phone: card.phone, email: card.email, linked: card.identityId !== null };
}

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`;

/**
 * This business's own cards whose name contains the text, or whose phone contains its digits. Never app accounts
 * that have not booked here (VIS-38): an app customer has a card here only through their own booking.
 */
export async function searchCustomerCards(session: AuthenticatedSession, businessId: string, query: string) {
  await validateAuthenticatedSession(session);
  await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']);
  const text = query.trim(), { byName, byPhone, digits } = customerSearchKind(text);
  if (!byPhone && !byName) return { cards: [] };
  // A phone is typed the local way (050…) and stored as E.164 (+97250…): match it without the trunk zero too.
  const phoneDigits = [digits, ...(digits.startsWith('0') && digits.length >= CUSTOMER_SEARCH_MIN_DIGITS ? [digits.slice(1)] : [])];
  const name = byName ? likePattern(text) : null, phone = byPhone ? likePattern(phoneDigits[0]!) : null, trunkless = byPhone && phoneDigits[1] ? likePattern(phoneDigits[1]) : null;
  const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "CustomerCard" WHERE "businessId" = ${businessId}
    AND ((${name}::text IS NOT NULL AND name ILIKE ${name}::text) OR (${phone}::text IS NOT NULL AND phone LIKE ${phone}::text) OR (${trunkless}::text IS NOT NULL AND phone LIKE ${trunkless}::text))
    ORDER BY name ASC NULLS LAST, id ASC LIMIT ${CUSTOMER_CARD_SUGGESTIONS}`;
  const cards = await prisma.customerCard.findMany({ where: { businessId, id: { in: ids.map(row => row.id) } }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return { cards: cards.map(customerCardSummary) };
}

/** A card of this business with that phone, linked or not: saving the phone again offers it instead (criterion 3). */
export function findCardByPhone(tx: Prisma.TransactionClient, businessId: string, phone: string) {
  return tx.customerCard.findFirst({ where: { businessId, phone }, orderBy: [{ identityId: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] });
}
export function customerCardExists(card: CustomerCard) {
  return new AppError(409, CUSTOMER_CARD_EXISTS, 'This business already has a customer with that phone.', undefined, { card: customerCardSummary(card) });
}

/**
 * Booking is the person's own act, so their own confirmed booking puts them on the business's books as a linked
 * card (decisions.md, "Saved customers and an invite to the app"). The card keeps the latest contacts the booking
 * snapshot gave the business, which are only verified ones.
 */
export async function attachOwnBookingCard(tx: Prisma.TransactionClient, bookingId: string) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { businessId: true, customerId: true, source: true, customerName: true, customerPhone: true, customerEmail: true } });
  if (booking.source !== 'CUSTOMER' || !booking.customerId) return null;
  const [card] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "CustomerCard" (id, "businessId", name, phone, email, "identityId", "linkedAt")
    VALUES (gen_random_uuid()::text, ${booking.businessId}, ${booking.customerName}, ${booking.customerPhone}, ${booking.customerEmail}, ${booking.customerId}, CURRENT_TIMESTAMP)
    ON CONFLICT ("businessId", "identityId") WHERE "identityId" IS NOT NULL DO UPDATE SET
      name = coalesce(EXCLUDED.name, "CustomerCard".name), phone = coalesce(EXCLUDED.phone, "CustomerCard".phone),
      email = coalesce(EXCLUDED.email, "CustomerCard".email), "updatedAt" = CURRENT_TIMESTAMP
    RETURNING id`;
  await tx.booking.update({ where: { id: bookingId }, data: { customerCardId: card!.id } });
  return card!.id;
}

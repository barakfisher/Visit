import { publicBusinessWhere } from './business-eligibility.js';
import { customerOwnedBookingWhere } from './booking-ownership.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from './sessions.js';
import { MembershipRole, MembershipStatus, type Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict, forbidden, notFound, rescheduleCutoff } from '../http/errors.js';
import { BusinessPermission, permissionWhere } from './business-permissions.js';

/** Who sees the whole business: they see its agenda and are told about all of its bookings. */
export const seesWholeBusinessWhere = Object.freeze(permissionWhere(BusinessPermission.SEE_ALL_CALENDARS));

/**
 * A membership counts when it is the owner's, sees every calendar, or is linked to a staff row that has not been
 * removed. A member with neither a calendar nor "see other calendars" has no workspace, whatever else is on
 * (the user's call, decisions.md "Switches"), so a removed worker is back in customer mode on the next read.
 */
export const countedMembershipWhere = Object.freeze({ OR: [{ role: MembershipRole.OWNER }, { seeAllCalendars: true }, { staffId: { not: null }, staff: { is: { archivedAt: null } } }] }) satisfies Prisma.MembershipWhereInput;

const contextBrand: unique symbol = Symbol('AuthorizedBusinessContext');
const publicContextBrand: unique symbol = Symbol('PublicBusinessContext');
const issuedMembershipContexts = new WeakSet<object>();
const issuedPublicContexts = new WeakSet<object>();

export type AuthorizedBusinessContext = Readonly<{
  identityId: string;
  businessId: string;
  role: MembershipRole;
  [contextBrand]: true;
}>;

export type PublicBusinessContext = Readonly<{ businessId: string; timezone: string; ownedBookingId?: string; customerId?: string; [publicContextBrand]: true }>;

/** The member's context for a business, if their one membership there counts and holds the permission. */
export async function requireBusinessMembership(
  identityId: string,
  businessId: string,
  permission: BusinessPermission = BusinessPermission.WORKSPACE,
): Promise<AuthorizedBusinessContext> {
  const membership = await prisma.membership.findFirst({
    where: {
      identityId,
      businessId,
      status: MembershipStatus.ACTIVE,
      business: { approvalStatus: 'APPROVED' },
      AND: [countedMembershipWhere, permissionWhere(permission)],
    },
    select: { role: true },
  });
  if (!membership) throw forbidden();
  const context = Object.freeze({ identityId, businessId, role: membership.role, [contextBrand]: true as const });
  issuedMembershipContexts.add(context);
  return context;
}

/** The member's context for a business, if they hold the permission there. */
export function requireBusinessPermission(identityId: string, businessId: string, permission: BusinessPermission) {
  return requireBusinessMembership(identityId, businessId, permission);
}

export async function requirePublicBusiness(businessId: string): Promise<PublicBusinessContext> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, ...publicBusinessWhere },
    select: { id: true, timezone: true },
  });
  if (!business) throw notFound();
  const context = Object.freeze({ businessId: business.id, timezone: business.timezone, [publicContextBrand]: true as const });
  issuedPublicContexts.add(context);
  return context;
}

export async function validateBusinessContext(context: AuthorizedBusinessContext, permission?: BusinessPermission) {
  if (!context || !issuedMembershipContexts.has(context)) throw forbidden();
  // Contexts are in-process capabilities, not permanent membership grants: the switches are read again.
  const current = await requireBusinessMembership(context.identityId, context.businessId, permission);
  if (current.role !== context.role) throw forbidden();
}

/** Rechecks an issued context against the member's current permission. */
export function validateBusinessPermission(context: AuthorizedBusinessContext, permission: BusinessPermission) {
  return validateBusinessContext(context, permission);
}

export async function validatePublicBusinessContext(context: PublicBusinessContext) {
  if (!context || !issuedPublicContexts.has(context)) throw forbidden();
  if (context.ownedBookingId && context.customerId) await validateOwnedReschedule(context.ownedBookingId, context.customerId);
  else await requirePublicBusiness(context.businessId);
}

async function validateOwnedReschedule(bookingId: string, customerId: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, ...customerOwnedBookingWhere(customerId), status: 'CONFIRMED', business: { approvalStatus: 'APPROVED', deletedAt: null } }, include: { business: { include: { bookingPolicy: true } } } });
  if (!booking) throw notFound();
  if (!booking.business.bookingPolicy) throw conflict('This business has not configured its booking policy.');
  if (booking.startsAt.getTime() < Date.now() + booking.business.bookingPolicy.rescheduleCutoffMinutes * 60000) throw rescheduleCutoff();
  return booking;
}
export async function requireOwnedReschedule(actor: AuthenticatedSession, bookingId: string) {
  await validateAuthenticatedSession(actor);
  const booking = await validateOwnedReschedule(bookingId, actor.identity.id);
  const context = Object.freeze({ businessId: booking.businessId, timezone: booking.business.timezone, ownedBookingId: booking.id, customerId: actor.identity.id, [publicContextBrand]: true as const });
  issuedPublicContexts.add(context);
  return { context, serviceId: booking.serviceId, booking };
}

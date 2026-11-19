import { publicBusinessWhere } from './business-eligibility.js';
import { customerOwnedBookingWhere } from './booking-ownership.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from './sessions.js';
import { MembershipRole, MembershipStatus, type Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict, forbidden, notFound, rescheduleCutoff } from '../http/errors.js';
import { BusinessPermission, ROLE_PRIORITY, rolesWith } from './business-permissions.js';

/** Who sees the whole business: they see its agenda and are told about all of its bookings. */
export const MANAGING_ROLES: readonly MembershipRole[] = Object.freeze(rolesWith(BusinessPermission.SEE_ALL_CALENDARS));

/**
 * A Staff membership counts only while it is linked to a staff row that has not been removed: an unlinked worker
 * (an invitation from before calendars, or a link that was revoked) has no workspace (worker-access.md, slice 3).
 */
export const countedMembershipWhere = Object.freeze({ OR: [{ role: { not: MembershipRole.STAFF } }, { staffId: { not: null }, staff: { is: { archivedAt: null } } }] }) satisfies Prisma.MembershipWhereInput;

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

export async function requireBusinessMembership(
  identityId: string,
  businessId: string,
  allowedRoles?: readonly MembershipRole[],
): Promise<AuthorizedBusinessContext> {
  const memberships = await prisma.membership.findMany({
    where: {
      identityId,
      businessId,
      status: MembershipStatus.ACTIVE,
      ...(allowedRoles ? { role: { in: [...allowedRoles] } } : {}),
      business: { approvalStatus: 'APPROVED' },
      ...countedMembershipWhere,
    },
    select: { role: true },
  });
  const membership = ROLE_PRIORITY.map(role => memberships.find(m => m.role === role)).find(Boolean);
  if (!membership) throw forbidden();
  const context = Object.freeze({ identityId, businessId, role: membership.role, [contextBrand]: true as const });
  issuedMembershipContexts.add(context);
  return context;
}

/** The member's context for a business, if they hold the permission there. */
export function requireBusinessPermission(identityId: string, businessId: string, permission: BusinessPermission) {
  return requireBusinessMembership(identityId, businessId, rolesWith(permission));
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

export function assertMembershipRole(context: AuthorizedBusinessContext, roles: readonly MembershipRole[]) {
  if (!context || !issuedMembershipContexts.has(context) || !roles.includes(context.role)) throw forbidden();
}

export async function validateBusinessContext(context: AuthorizedBusinessContext, roles?: readonly MembershipRole[]) {
  if (!context || !issuedMembershipContexts.has(context)) throw forbidden();
  if (roles) assertMembershipRole(context, roles);
  // Contexts are in-process capabilities, not permanent membership grants.
  await requireBusinessMembership(context.identityId, context.businessId, [context.role]);
}

/** Rechecks an issued context against the member's current permission. */
export function validateBusinessPermission(context: AuthorizedBusinessContext, permission: BusinessPermission) {
  return validateBusinessContext(context, rolesWith(permission));
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

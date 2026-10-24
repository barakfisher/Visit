import { MembershipRole, MembershipStatus } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { forbidden, notFound } from '../http/errors.js';

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

export type PublicBusinessContext = Readonly<{ businessId: string; timezone: string; [publicContextBrand]: true }>;

export async function requireBusinessMembership(
  identityId: string,
  businessId: string,
  allowedRoles?: readonly MembershipRole[],
): Promise<AuthorizedBusinessContext> {
  const membership = await prisma.membership.findFirst({
    where: {
      identityId,
      businessId,
      status: MembershipStatus.ACTIVE,
      ...(allowedRoles ? { role: { in: [...allowedRoles] } } : {}),
      business: { approvalStatus: 'APPROVED' },
    },
    select: { role: true },
  });
  if (!membership) throw forbidden();
  const context = Object.freeze({ identityId, businessId, role: membership.role, [contextBrand]: true as const });
  issuedMembershipContexts.add(context);
  return context;
}

export async function requirePublicBusiness(businessId: string): Promise<PublicBusinessContext> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, approvalStatus: 'APPROVED' },
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

export async function validatePublicBusinessContext(context: PublicBusinessContext) {
  if (!context || !issuedPublicContexts.has(context)) throw forbidden();
  await requirePublicBusiness(context.businessId);
}

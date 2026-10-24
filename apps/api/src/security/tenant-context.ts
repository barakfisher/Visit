import { MembershipRole, MembershipStatus } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { forbidden, notFound } from '../http/errors.js';

const contextBrand: unique symbol = Symbol('AuthorizedBusinessContext');

export type AuthorizedBusinessContext = Readonly<{
  identityId: string;
  businessId: string;
  role: MembershipRole;
  [contextBrand]: true;
}>;

export type PublicBusinessContext = Readonly<{ businessId: string; timezone: string }>;

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
  return Object.freeze({ identityId, businessId, role: membership.role, [contextBrand]: true as const });
}

export async function requirePublicBusiness(businessId: string): Promise<PublicBusinessContext> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, approvalStatus: 'APPROVED' },
    select: { id: true, timezone: true },
  });
  if (!business) throw notFound();
  return Object.freeze({ businessId: business.id, timezone: business.timezone });
}

export function assertMembershipRole(context: AuthorizedBusinessContext, roles: readonly MembershipRole[]) {
  if (!roles.includes(context.role)) throw forbidden();
}

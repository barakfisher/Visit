export const PROVIDER_REGISTRATION_PATH = '/register/provider';
/** Login offers "Have a business?" unless the visitor is already on the way to the provider application. */
export const showsProviderEntry = (returnTo: string | undefined) => returnTo !== PROVIDER_REGISTRATION_PATH;
export type AccountNavigation = {
  identity: { platformRole: string; displayName?: string | null };
  memberships: { role: string; status: string; business: { id: string; name: string; approvalStatus: string; publishedAt?: string | null } }[];
  providerApplications: { id: string; status: string; business: { name: string } }[];
};
export function menuCapabilities(account?: AccountNavigation) {
  const eligible = account?.memberships.filter(m => m.status === 'ACTIVE' && m.business.approvalStatus === 'APPROVED' && ['OWNER', 'MANAGER'].includes(m.role)) ?? [];
  const byBusiness = new Map<string, (typeof eligible)[number]>();
  for (const membership of eligible) if (!byBusiness.has(membership.business.id) || membership.role === 'OWNER') byBusiness.set(membership.business.id, membership);
  const managed = [...byBusiness.values()];
  const applicationStatus = account?.providerApplications.some(a => ['PENDING', 'REJECTED'].includes(a.status)) ?? false;
  // The menu entry is a shortcut only; the review routes refuse anyone who is not an administrator.
  return { managed, applicationStatus, becomeProvider: !!account && !managed.length && !applicationStatus, reviewApplications: account?.identity.platformRole === 'ADMIN' };
}

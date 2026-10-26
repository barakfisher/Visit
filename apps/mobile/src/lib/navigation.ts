export type AccountNavigation = {
  identity: { platformRole: string };
  memberships: { role: string; status: string; business: { id: string; name: string; approvalStatus: string } }[];
  providerApplications: { id: string; status: string; business: { name: string } }[];
};
export function menuCapabilities(account?: AccountNavigation) {
  const eligible = account?.memberships.filter(m => m.status === 'ACTIVE' && m.business.approvalStatus === 'APPROVED' && ['OWNER', 'MANAGER'].includes(m.role)) ?? [];
  const byBusiness = new Map<string, (typeof eligible)[number]>();
  for (const membership of eligible) if (!byBusiness.has(membership.business.id) || membership.role === 'OWNER') byBusiness.set(membership.business.id, membership);
  const managed = [...byBusiness.values()];
  const applicationStatus = account?.providerApplications.some(a => ['PENDING', 'REJECTED'].includes(a.status)) ?? false;
  return { managed, applicationStatus, becomeProvider: !!account && !managed.length && !applicationStatus };
}

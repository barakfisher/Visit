export type AccountNavigation = {
  identity: { platformRole: string };
  memberships: { role: string; status: string; business: { id: string; name: string; approvalStatus: string } }[];
  providerApplications: { id: string; status: string; business: { name: string } }[];
};
export function menuCapabilities(account?: AccountNavigation) {
  const managed = account?.memberships.filter(m => m.status === 'ACTIVE' && m.business.approvalStatus === 'APPROVED' && ['OWNER', 'MANAGER'].includes(m.role)) ?? [];
  const applicationStatus = account?.providerApplications.some(a => ['PENDING', 'REJECTED'].includes(a.status)) ?? false;
  return { managed, applicationStatus, becomeProvider: !!account && !managed.length && !applicationStatus };
}

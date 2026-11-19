export const PROVIDER_REGISTRATION_PATH = '/register/provider';
/** Login offers "Have a business?" unless the visitor is already on the way to the provider application. */
export const showsProviderEntry = (returnTo: string | undefined) => returnTo !== PROVIDER_REGISTRATION_PATH;
export type AccountNavigation = {
  identity: { platformRole: string; displayName?: string | null };
  /** `calendar` is the live staff row a membership works on; a Staff membership without one opens nothing. */
  memberships: { role: string; status: string; calendar?: { id: string; displayName: string; active: boolean } | null; business: { id: string; name: string; approvalStatus: string; publishedAt?: string | null } }[];
  providerApplications: { id: string; status: string; business: { name: string } }[];
};
/** Add appointment is its own business screen, so the footer can mark it (decisions.md, 2026-11-10). */
export const isProviderPath = (pathname: string) => pathname.startsWith('/provider/');
/** Account and the notifications belong to the person, not to a mode: each keeps the business it was opened from, carried in its URL so a reload keeps it too. Only a business in the person's own profile counts. */
export const accountBusiness = (pathname: string, businessId: string | string[] | undefined, businesses: readonly { id: string }[] | undefined) => (pathname === '/account' || pathname === '/notifications') && businesses?.some(business => business.id === businessId) ? businessId as string : null;
/** A screen outside the signed-in shell keeps the whole screen. Booking has its own commit bar and keeps the footer under it (decisions.md, 2026-11-09). */
export const footerHidden = (pathname: string) => ['/auth', '/register', '/invite'].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
export function menuCapabilities(account?: AccountNavigation) {
  // A worker linked to a calendar opens provider mode too, on their own My day (worker-access.md, slice 3).
  const opens = (m: AccountNavigation['memberships'][number]) => ['OWNER', 'MANAGER'].includes(m.role) || (m.role === 'STAFF' && !!m.calendar);
  const eligible = account?.memberships.filter(m => m.status === 'ACTIVE' && m.business.approvalStatus === 'APPROVED' && opens(m)) ?? [];
  const rank: Record<string, number> = { OWNER: 3, MANAGER: 2, STAFF: 1 };
  const byBusiness = new Map<string, (typeof eligible)[number]>();
  for (const membership of eligible) if (!byBusiness.has(membership.business.id) || rank[membership.role]! > rank[byBusiness.get(membership.business.id)!.role]!) byBusiness.set(membership.business.id, membership);
  const managed = [...byBusiness.values()];
  // Working on someone else's calendar is not having a business of one's own: a worker can still apply for theirs.
  const owns = managed.some(m => m.role !== 'STAFF');
  const applicationStatus = account?.providerApplications.some(a => ['PENDING', 'REJECTED'].includes(a.status)) ?? false;
  // The Account block is a shortcut only; the review routes refuse anyone who is not an administrator.
  return { managed, applicationStatus, becomeProvider: !!account && !owns && !applicationStatus, reviewApplications: account?.identity.platformRole === 'ADMIN' };
}

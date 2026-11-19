import { memberLabel, opensWorkspace, type MemberSwitches } from './MemberSwitches';
export const PROVIDER_REGISTRATION_PATH = '/register/provider';
/** Login offers "Have a business?" unless the visitor is already on the way to the provider application. */
export const showsProviderEntry = (returnTo: string | undefined) => returnTo !== PROVIDER_REGISTRATION_PATH;
export type AccountNavigation = {
  identity: { platformRole: string; displayName?: string | null };
  /** `calendar` is the live staff row a membership works on; `switches` what it may do (decisions.md, "Switches"). One membership per business. */
  memberships: { role: string; status: string; switches?: MemberSwitches; calendar?: { id: string; displayName: string; active: boolean } | null; business: { id: string; name: string; approvalStatus: string; publishedAt?: string | null } }[];
  providerApplications: { id: string; status: string; business: { name: string } }[];
};
/** Add appointment is its own business screen, so the footer can mark it (decisions.md, 2026-11-10). */
export const isProviderPath = (pathname: string) => pathname.startsWith('/provider/');
/** Account and the notifications belong to the person, not to a mode: each keeps the business it was opened from, carried in its URL so a reload keeps it too. Only a business in the person's own profile counts. */
export const accountBusiness = (pathname: string, businessId: string | string[] | undefined, businesses: readonly { id: string }[] | undefined) => (pathname === '/account' || pathname === '/notifications') && businesses?.some(business => business.id === businessId) ? businessId as string : null;
/** A screen outside the signed-in shell keeps the whole screen. Booking has its own commit bar and keeps the footer under it (decisions.md, 2026-11-09). */
export const footerHidden = (pathname: string) => ['/auth', '/register', '/invite'].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
export function menuCapabilities(account?: AccountNavigation) {
  // The owner, a member who sees every calendar, and a worker linked to a calendar open provider mode (worker-access.md).
  const managed = account?.memberships.filter(m => m.status === 'ACTIVE' && m.business.approvalStatus === 'APPROVED' && opensWorkspace(m.role, m.switches, !!m.calendar)) ?? [];
  // Working on someone else's business is not having one's own: only an owner or a full manager is past "become a provider".
  const owns = managed.some(m => m.role === 'OWNER' || (m.switches && memberLabel('MEMBER', m.switches).kind === 'manager'));
  const applicationStatus = account?.providerApplications.some(a => ['PENDING', 'REJECTED'].includes(a.status)) ?? false;
  // The Account block is a shortcut only; the review routes refuse anyone who is not an administrator.
  return { managed, applicationStatus, becomeProvider: !!account && !owns && !applicationStatus, reviewApplications: account?.identity.platformRole === 'ADMIN' };
}

import type { MembershipRole } from '../generated/prisma/client.js';

/**
 * What a member may do in one business. Every provider check names one of these instead of a list of roles,
 * so the answer can later come from per-member switches (worker-access.md, Privileges) without touching call sites.
 */
export const BusinessPermission = {
  /** Open provider mode for the business. */
  WORKSPACE: 'WORKSPACE',
  /** Read every staff row's agenda, blocks and appointments. */
  SEE_ALL_CALENDARS: 'SEE_ALL_CALENDARS',
  /** Add, move, cancel, block and mark outcomes on any staff row. */
  ACT_ON_ALL_CALENDARS: 'ACT_ON_ALL_CALENDARS',
  /** Search the business's customer cards. */
  SEARCH_CUSTOMERS: 'SEARCH_CUSTOMERS',
  /** Services, prices, hours, booking policy, staff rows, profile and publication. */
  BUSINESS_SETUP: 'BUSINESS_SETUP',
  /** Invite members and remove their access. */
  MANAGE_TEAM: 'MANAGE_TEAM',
  /** See and act on the member's own linked staff row only (worker-access.md, slice 3). Meaningless without a link. */
  OWN_CALENDAR: 'OWN_CALENDAR',
  /** Tie an invitation to a staff row, which hands that calendar to whoever accepts. Owner only (decisions.md, "My day for a worker"). */
  LINK_CALENDARS: 'LINK_CALENDARS',
} as const;
export type BusinessPermission = typeof BusinessPermission[keyof typeof BusinessPermission];

const ALL: readonly BusinessPermission[] = Object.freeze(Object.values(BusinessPermission));

/**
 * Today's grants, by role. A worker (Staff) opens provider mode, works their own calendar and searches customer cards;
 * a Staff membership counts only while it is linked to a live staff row (tenant-context.ts, countedMembershipWhere).
 * Only the owner links calendars, until slice 5 makes these switches.
 */
const ROLE_GRANTS: Readonly<Record<MembershipRole, readonly BusinessPermission[]>> = Object.freeze({
  OWNER: ALL,
  MANAGER: Object.freeze(ALL.filter(permission => permission !== BusinessPermission.LINK_CALENDARS)),
  STAFF: Object.freeze([BusinessPermission.WORKSPACE, BusinessPermission.OWN_CALENDAR, BusinessPermission.SEARCH_CUSTOMERS]),
});

/** Strongest first: when one identity holds several roles in a business, the first one found is used. */
export const ROLE_PRIORITY: readonly MembershipRole[] = Object.freeze(['OWNER', 'MANAGER', 'STAFF']);

export function roleHas(role: MembershipRole, permission: BusinessPermission) {
  return ROLE_GRANTS[role].includes(permission);
}

/** The roles granted a permission, for membership queries (`role: { in: rolesWith(...) }`). A fresh array each call, so no caller can change another's. */
export function rolesWith(permission: BusinessPermission): MembershipRole[] {
  return ROLE_PRIORITY.filter(role => roleHas(role, permission));
}

/**
 * Whether a member of one role may hand another role out: only with MANAGE_TEAM, and only a role holding strictly fewer
 * permissions than their own, so nobody grants what they do not hold, nor their own level. Today this is the owner
 * inviting Managers and Staff, and a manager inviting Staff.
 */
export function mayGrantRole(actor: MembershipRole, role: MembershipRole) {
  const own = ROLE_GRANTS[actor], granted = ROLE_GRANTS[role];
  return roleHas(actor, BusinessPermission.MANAGE_TEAM) && granted.every(permission => own.includes(permission)) && own.length > granted.length;
}

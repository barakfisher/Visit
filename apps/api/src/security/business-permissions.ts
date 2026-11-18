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
} as const;
export type BusinessPermission = typeof BusinessPermission[keyof typeof BusinessPermission];

const ALL: readonly BusinessPermission[] = Object.freeze(Object.values(BusinessPermission));

/** Today's grants, by role. Owner and Manager hold everything; Staff holds nothing yet (worker-access.md, slice 3). */
const ROLE_GRANTS: Readonly<Record<MembershipRole, readonly BusinessPermission[]>> = Object.freeze({
  OWNER: ALL,
  MANAGER: ALL,
  STAFF: Object.freeze([]),
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

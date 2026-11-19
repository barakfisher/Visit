import { Prisma, type MembershipRole } from '../generated/prisma/client.js';

/**
 * What a member may do in one business. Every provider check names one of these, and the answer comes from the
 * member's four stored switches (worker-access.md, Privileges; decisions.md, "Switches").
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
  /** Change a member's switches. Owner only, and never their own (decisions.md, "Member privileges design"). */
  CHANGE_SWITCHES: 'CHANGE_SWITCHES',
} as const;
export type BusinessPermission = typeof BusinessPermission[keyof typeof BusinessPermission];

/** The four stored switches, in the order the member card shows them. */
export const MEMBER_SWITCHES = Object.freeze(['seeAllCalendars', 'actOnAllCalendars', 'businessSetup', 'manageTeam'] as const);
export type MemberSwitch = typeof MEMBER_SWITCHES[number];
export type MemberSwitches = Readonly<Record<MemberSwitch, boolean>>;
/** What a permission check needs from a membership row. */
export type MemberGrants = Readonly<{ role: MembershipRole }> & MemberSwitches;

const allSwitches = (value: boolean): MemberSwitches => Object.freeze(Object.fromEntries(MEMBER_SWITCHES.map(name => [name, value])) as Record<MemberSwitch, boolean>);
/** An invitation's role only picks these starting values (decisions.md, "Member privileges design"). */
export const MEMBER_PRESETS: Readonly<Record<'MANAGER' | 'STAFF', MemberSwitches>> = Object.freeze({ MANAGER: allSwitches(true), STAFF: allSwitches(false) });
export type InvitePreset = keyof typeof MEMBER_PRESETS;
/** A new member row for a preset. */
export const memberPreset = (preset: InvitePreset) => Object.freeze({ role: 'MEMBER' as const, ...MEMBER_PRESETS[preset] });

/** The switch each permission reads. Permissions with no switch are every member's; owner-only ones are listed apart. */
const SWITCH_FOR: Readonly<Partial<Record<BusinessPermission, MemberSwitch>>> = Object.freeze({
  SEE_ALL_CALENDARS: 'seeAllCalendars',
  ACT_ON_ALL_CALENDARS: 'actOnAllCalendars',
  BUSINESS_SETUP: 'businessSetup',
  MANAGE_TEAM: 'manageTeam',
});
const OWNER_ONLY: readonly BusinessPermission[] = Object.freeze([BusinessPermission.LINK_CALENDARS, BusinessPermission.CHANGE_SWITCHES]);

/** Whether one membership row holds a permission. The owner holds every one. */
export function memberHas(member: MemberGrants, permission: BusinessPermission) {
  if (member.role === 'OWNER') return true;
  if (OWNER_ONLY.includes(permission)) return false;
  const name = SWITCH_FOR[permission];
  return name ? member[name] : true;
}

/**
 * The same rule as a membership filter, for queries and for rechecks inside a transaction. An owner row matches every
 * switch because the database keeps all four on for owners (Membership_owner_switches_check).
 */
export function permissionWhere(permission: BusinessPermission): Prisma.MembershipWhereInput {
  if (OWNER_ONLY.includes(permission)) return { role: 'OWNER' };
  const name = SWITCH_FOR[permission];
  return name ? { [name]: true } : {};
}

/** The same rule as SQL on a `"Membership"` row, for the raw `FOR SHARE` locks. */
export function permissionSql(permission: BusinessPermission): Prisma.Sql {
  if (OWNER_ONLY.includes(permission)) return Prisma.sql`role = 'OWNER'`;
  const name = SWITCH_FOR[permission];
  return name ? Prisma.raw(`"${name}" = true`) : Prisma.sql`TRUE`;
}

/** The switches of a row, without anything else it carries. */
export const switchesOf = (member: MemberSwitches): MemberSwitches => Object.freeze(Object.fromEntries(MEMBER_SWITCHES.map(name => [name, member[name]])) as Record<MemberSwitch, boolean>);

/**
 * Whether an actor may hand out, or take away, a set of switches. The owner may for any member. Anyone else needs
 * MANAGE_TEAM and must hold every switch the other has plus at least one more, so nobody grants or removes their
 * own level or above (the user's call, decisions.md "Switches"). In practice a manager invites and removes workers.
 */
export function mayGrant(actor: MemberGrants, target: MemberSwitches) {
  if (actor.role === 'OWNER') return true;
  if (!memberHas(actor, BusinessPermission.MANAGE_TEAM)) return false;
  const held = MEMBER_SWITCHES.filter(name => actor[name]), granted = MEMBER_SWITCHES.filter(name => target[name]);
  return granted.every(name => actor[name]) && held.length > granted.length;
}

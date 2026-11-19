/**
 * A member's four switches (worker-access.md, Privileges; decisions.md, "Switches"). The server decides every
 * permission; this file only labels them and keeps the editor to the pairs the server accepts.
 */
export const MEMBER_SWITCHES = ['seeAllCalendars', 'actOnAllCalendars', 'businessSetup', 'manageTeam'] as const;
export type MemberSwitch = typeof MEMBER_SWITCHES[number];
export type MemberSwitches = Record<MemberSwitch, boolean>;
export type MembershipRole = 'OWNER' | 'MEMBER';

export const NO_SWITCHES: MemberSwitches = Object.freeze({ seeAllCalendars: false, actOnAllCalendars: false, businessSetup: false, manageTeam: false });

/** The card label: Manager when all four are on, otherwise Worker plus the extra permissions it has. */
export type MemberLabel = { kind: 'owner' } | { kind: 'manager' } | { kind: 'worker'; extras: MemberSwitch[] };
export function memberLabel(role: MembershipRole, switches: MemberSwitches): MemberLabel {
  if (role === 'OWNER') return { kind: 'owner' };
  const extras = MEMBER_SWITCHES.filter(name => switches[name]);
  return extras.length === MEMBER_SWITCHES.length ? { kind: 'manager' } : { kind: 'worker', extras };
}

/** Acting on other calendars needs seeing them: turning "act" on turns "see" on, and turning "see" off turns "act" off. */
export function withSwitch(switches: MemberSwitches, name: MemberSwitch, on: boolean): MemberSwitches {
  const next = { ...switches, [name]: on };
  if (name === 'actOnAllCalendars' && on) next.seeAllCalendars = true;
  if (name === 'seeAllCalendars' && !on) next.actOnAllCalendars = false;
  return next;
}

export const sameSwitches = (a: MemberSwitches, b: MemberSwitches) => MEMBER_SWITCHES.every(name => a[name] === b[name]);

/** Without a calendar a member opens provider mode only with "see other calendars" (the user's call). */
export const opensWorkspace = (role: string, switches: MemberSwitches | undefined, hasCalendar: boolean) => role === 'OWNER' || !!switches?.seeAllCalendars || hasCalendar;

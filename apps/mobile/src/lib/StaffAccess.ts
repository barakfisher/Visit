import { ApiError } from './apiClient';

/** The API's team listing (`apps/api/src/repositories/business-access.ts`, `team`). */
export type TeamStaffLink = { id: string; displayName: string; membershipId: string };
export type TeamMember = { id: string; identityId: string; role: 'OWNER' | 'MANAGER' | 'STAFF'; label: string; name: string | null; staff: TeamStaffLink | null };
export type TeamInvitation = { id: string; role: 'MANAGER' | 'STAFF'; recipientHint: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; staff: { id: string; displayName: string } | null };
/** `canLinkCalendars`: only the owner ties an invitation to a calendar (decisions.md, "My day for a worker"). */
export type Team = { role: 'OWNER' | 'MANAGER' | 'STAFF'; canLinkCalendars?: boolean; members: TeamMember[]; invitations: TeamInvitation[] };

export type InviteRole = 'STAFF' | 'MANAGER';
export type InviteChannel = 'email' | 'phone';

/** A staff card's app access: who, if anyone, works on this calendar in the app. */
export type StaffAccess =
  | { kind: 'none' }
  | { kind: 'pending'; invitationId: string; recipientHint: string; role: InviteRole }
  | { kind: 'active'; membershipId: string; account: string; role: TeamMember['role'] };

/** The server codes this screen answers (`business-access.ts`, `provider-settings.ts`). */
export const STAFF_ALREADY_LINKED = 'STAFF_ALREADY_LINKED';
export const STAFF_HAS_APP_ACCESS = 'STAFF_HAS_APP_ACCESS';
export const INVITATION_STAFF_REMOVED = 'INVITATION_STAFF_REMOVED';
export const INVITATION_STAFF_LINKED = 'INVITATION_STAFF_LINKED';
export const INVITATION_OWNER_LINK = 'INVITATION_OWNER_LINK';
export const MIN_RECIPIENT = 8, MAX_RECIPIENT = 254;

export function staffAccess(team: Team, staffId: string, now = new Date()): StaffAccess {
  const member = team.members.find(item => item.staff?.id === staffId);
  if (member) return { kind: 'active', membershipId: member.staff!.membershipId, account: member.name ?? member.label, role: member.role };
  // The server keeps at most one live invitation per calendar; the newest is the one that counts.
  const invitation = team.invitations.find(item => item.staff?.id === staffId && !item.acceptedAt && !item.revokedAt && new Date(item.expiresAt) > now);
  return invitation ? { kind: 'pending', invitationId: invitation.id, recipientHint: invitation.recipientHint, role: invitation.role } : { kind: 'none' };
}

/** Owners invite workers and managers; a manager invites workers only (`permittedInvite`). */
export function invitableRoles(role: Team['role']): InviteRole[] { return role === 'OWNER' ? ['STAFF', 'MANAGER'] : role === 'MANAGER' ? ['STAFF'] : []; }

/** The same shapes the server accepts: E.164 phone, or a plain email address. */
export function validRecipient(channel: InviteChannel, value: string) {
  const trimmed = value.trim();
  // The server also requires 8 to 254 characters (routes/business-access.ts).
  return channel === 'phone' ? /^\+[1-9]\d{7,14}$/.test(trimmed) : trimmed.length >= MIN_RECIPIENT && trimmed.length <= MAX_RECIPIENT && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export const isApiCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

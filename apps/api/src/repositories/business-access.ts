import { createHmac } from 'node:crypto';
import { prisma } from '../db/client.js';
import { signalAgendaChanged } from '../infra/live-signals.js';
import { env } from '../env.js';
import { AppError, conflict, forbidden, notFound } from '../http/errors.js';
import type { Prisma, BusinessInvitation, Membership } from '../generated/prisma/client.js';
import { lockIdentitySecurity, lockRecentAccountSession, requireRecentAccountAuth } from '../security/account-security.js';
import { newOpaqueToken, tokenDigest, validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { ensureRedisReady, redis } from '../infra/redis.js';
import { countedMembershipWhere } from '../security/tenant-context.js';
import { BusinessPermission, MEMBER_PRESETS, mayGrant, memberHas, memberPreset, permissionWhere, switchesOf, type InvitePreset, type MemberGrants, type MemberSwitches } from '../security/business-permissions.js';

/** Who may invite whom, by the invitation's preset, follows the switches (business-permissions.ts, mayGrant). */
export const permittedInvite = (actor: MemberGrants, preset: InvitePreset) => mayGrant(actor, MEMBER_PRESETS[preset]);
/** Who may remove whom: never an owner, never oneself, and only a member holding less than the actor. */
const permittedRemove = (actor: Membership, member: Membership) => member.role !== 'OWNER' && member.identityId !== actor.identityId && mayGrant(actor, member);
const presetOf = (role: string): InvitePreset => { if (role === 'MANAGER' || role === 'STAFF') return role; throw unavailable(); };
export const recipientDigest = (channel: string, recipient: string) => createHmac('sha256', env.SESSION_SECRET).update(`business-invite:${channel}:${recipient}`).digest('hex');
export function normalizeRecipient(channel: 'email' | 'phone', value: string) {
  const normalized = value.trim();
  if (channel === 'phone') {
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new AppError(400, 'VALIDATION_ERROR', 'Use a phone number with country code.');
    return normalized;
  }
  return normalized.toLowerCase();
}
export const INVITATION_UNAVAILABLE = 'INVITATION_UNAVAILABLE', INVITATION_OWNER_LINK = 'INVITATION_OWNER_LINK', INVITATION_ALREADY_MEMBER = 'INVITATION_ALREADY_MEMBER';
const unavailable = () => new AppError(409, INVITATION_UNAVAILABLE, 'This invitation is unavailable. Request a new invitation.');
export const STAFF_ALREADY_LINKED = 'STAFF_ALREADY_LINKED', INVITATION_STAFF_REMOVED = 'INVITATION_STAFF_REMOVED', INVITATION_STAFF_LINKED = 'INVITATION_STAFF_LINKED';
/** Locks a live staff row of this business, or null when it does not exist here or was removed. */
async function lockStaff(tx: Prisma.TransactionClient, businessId: string, staffId: string) {
  await tx.$queryRaw`SELECT id FROM "Staff" WHERE id = ${staffId} AND "businessId" = ${businessId} FOR UPDATE`;
  return tx.staff.findFirst({ where: { id: staffId, businessId, archivedAt: null }, select: { id: true, displayName: true } });
}
const linkedAccount = (tx: Prisma.TransactionClient, businessId: string, staffId: string) => tx.membership.findFirst({ where: { businessId, staffId, status: 'ACTIVE' }, select: { id: true, identityId: true } });
async function limit(actor: AuthenticatedSession) {
  try {
    await ensureRedisReady();
    const count = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; return n", 1, `visit:invitation-limit:${actor.identity.id}`));
    if (count > 30) throw new AppError(429, 'RATE_LIMITED', 'Too many invitation requests. Try again later.');
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'UNAVAILABLE', 'Invitation service unavailable. Try again later.'); }
}
async function businessLock(tx: Prisma.TransactionClient, businessId: string) {
  await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
  const business = await tx.business.findUnique({ where: { id: businessId } });
  if (!business || business.deletedAt || business.approvalStatus !== 'APPROVED') throw forbidden();
  return business;
}
async function manager(tx: Prisma.TransactionClient, identityId: string, businessId: string) {
  // Locked, so a switch change committing meanwhile is seen before this member acts on it.
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "identityId" = ${identityId} AND "businessId" = ${businessId} FOR SHARE`;
  // A member who does not count (no calendar and no "see") has no workspace, so no team screen either.
  const membership = await tx.membership.findFirst({ where: { identityId, businessId, status: 'ACTIVE', AND: [permissionWhere(BusinessPermission.MANAGE_TEAM), countedMembershipWhere] } });
  if (!membership) throw forbidden();
  return membership;
}
async function mutation<T>(actor: AuthenticatedSession, businessId: string, work: (tx: Prisma.TransactionClient, membership: Awaited<ReturnType<typeof manager>>) => Promise<T>) {
  await requireRecentAccountAuth(actor);
  return prisma.$transaction(async tx => {
    await lockRecentAccountSession(tx, actor);
    await lockIdentitySecurity(tx, actor.identity.id);
    await businessLock(tx, businessId);
    return work(tx, await manager(tx, actor.identity.id, businessId));
  });
}
export async function team(actor: AuthenticatedSession, businessId: string) {
  await validateAuthenticatedSession(actor);
  return prisma.$transaction(async tx => {
    await businessLock(tx, businessId); const current = await manager(tx, actor.identity.id, businessId);
    const allMembers = await tx.membership.findMany({ where: { businessId, status: 'ACTIVE' }, include: { staff: { select: { id: true, displayName: true } }, identity: { select: { displayName: true, email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    // `removable` and `editable` are this viewer's answers, from the same rules the writes check.
    const members = allMembers.map(({ identity, staff, ...member }) => ({ id: member.id, identityId: member.identityId, role: member.role, switches: switchesOf(member), removable: permittedRemove(current, member as Membership), editable: mayChangeSwitches(current, member as Membership), name: identity.displayName?.trim() || null, staff: staff ? { membershipId: member.id, ...staff } : null, label: identity.email && identity.emailVerifiedAt ? `${identity.email.slice(0, 1)}***@${identity.email.split('@')[1]}` : identity.phone && identity.phoneVerifiedAt ? `***${identity.phone.slice(-4)}` : '—' }));
    return { role: current.role, switches: switchesOf(current), canLinkCalendars: memberHas(current, BusinessPermission.LINK_CALENDARS), canChangeSwitches: memberHas(current, BusinessPermission.CHANGE_SWITCHES), invitablePresets: (['STAFF', 'MANAGER'] as const).filter(preset => permittedInvite(current, preset)), members, invitations: await tx.businessInvitation.findMany({ where: { businessId }, select: { id: true, role: true, recipientHint: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true, staff: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });
}
export async function createInvitation(actor: AuthenticatedSession, businessId: string, input: { role: 'MANAGER' | 'STAFF'; channel: 'email' | 'phone'; recipient: string; staffId?: string | undefined }) {
  await requireRecentAccountAuth(actor); await limit(actor);
  const recipient = normalizeRecipient(input.channel, input.recipient), digest = recipientDigest(input.channel, recipient);
  const token = newOpaqueToken();
  const invitation = await mutation(actor, businessId, async (tx, member) => {
    if (!permittedInvite(member, input.role)) throw forbidden();
    const now = new Date();
    if (input.staffId) {
      // A calendar link hands that row's appointments and customers to whoever accepts, and the app cannot tell
      // which row is the owner's own, so only the owner links calendars (decisions.md, "My day for a worker").
      if (!memberHas(member, BusinessPermission.LINK_CALENDARS)) throw forbidden();
      // Another business's row reads as missing, exactly like a removed one.
      if (!await lockStaff(tx, businessId, input.staffId)) throw notFound();
      if (await linkedAccount(tx, businessId, input.staffId)) throw new AppError(409, STAFF_ALREADY_LINKED, 'This calendar already has app access. Remove it before inviting someone else.');
      // One live link per calendar: a new invitation replaces the previous one for this row,
      // but never one this member could not revoke directly (a manager replacing an owner's Manager link).
      const live = await tx.businessInvitation.findMany({ where: { businessId, staffId: input.staffId, acceptedAt: null, revokedAt: null }, select: { role: true } });
      if (live.some(item => !permittedInvite(member, presetOf(item.role)))) throw forbidden();
      await tx.businessInvitation.updateMany({ where: { businessId, staffId: input.staffId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now, revokedByIdentityId: actor.identity.id } });
    }
    // A lost creation response is recovered by issuing a new link, never storing its secret.
    // Never the owner's calendar link, which only a calendar linker may cancel.
    await tx.businessInvitation.updateMany({ where: { businessId, recipientDigest: digest, role: input.role, acceptedAt: null, revokedAt: null, ...(memberHas(member, BusinessPermission.LINK_CALENDARS) ? {} : { staffId: null }) }, data: { revokedAt: now, revokedByIdentityId: actor.identity.id } });
    if (await tx.businessInvitation.count({ where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }) >= 100) throw conflict('Revoke unused invitations before creating more.');
    return tx.businessInvitation.create({ data: { businessId, inviterIdentityId: actor.identity.id, inviterMembershipId: member.id, inviterRole: member.role, role: input.role, staffId: input.staffId ?? null, recipientChannel: input.channel, recipientDigest: digest, recipientHint: input.channel === 'email' ? `${recipient.slice(0, 1)}***@${recipient.split('@')[1]}` : `***${recipient.slice(-4)}`, tokenHash: tokenDigest(token), expiresAt: new Date(now.getTime() + 72 * 3600000) } });
  });
  return { id: invitation.id, expiresAt: invitation.expiresAt, url: `${env.WEB_APP_URL.replace(/\/$/, '')}/invite#invite=${token}` };
}
export async function revokeInvitation(actor: AuthenticatedSession, businessId: string, id: string) {
  return mutation(actor, businessId, async (tx, member) => {
    const invite = await tx.businessInvitation.findFirst({ where: { id, businessId } });
    if (!invite) throw notFound();
    if (!permittedInvite(member, presetOf(invite.role))) throw forbidden();
    // A calendar link is the owner's to make and to cancel.
    if (invite.staffId && !memberHas(member, BusinessPermission.LINK_CALENDARS)) throw forbidden();
    if (invite.acceptedAt) throw conflict('This invitation was already accepted. Manage the membership instead.');
    if (!invite.revokedAt) await tx.businessInvitation.update({ where: { id }, data: { revokedAt: new Date(), revokedByIdentityId: actor.identity.id } });
    return { revoked: true };
  });
}
async function checkInvite(tx: Prisma.TransactionClient, invite: BusinessInvitation, actor: AuthenticatedSession) {
  if (invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) throw unavailable();
  // A counted membership only: an inviter without "see" or a calendar opens nothing, so their links do not either.
  const member = await tx.membership.findFirst({ where: { id: invite.inviterMembershipId, AND: [countedMembershipWhere] } });
  // The inviter's current switches decide, so an invitation from someone who has since lost the right fails closed.
  if (!member || member.status !== 'ACTIVE' || !permittedInvite(member, presetOf(invite.role))) throw unavailable();
  // A calendar link made by someone who may no longer link calendars (a manager's, from before slice 3) fails closed.
  if (invite.staffId && !memberHas(member, BusinessPermission.LINK_CALENDARS)) throw unavailable();
  const identity = await tx.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
  const contact = invite.recipientChannel === 'email' ? (identity.emailVerifiedAt ? identity.email?.toLowerCase() : null) : (identity.phoneVerifiedAt ? identity.phone : null);
  if (!contact || recipientDigest(invite.recipientChannel, contact) !== invite.recipientDigest) throw new AppError(403, 'INVITATION_RECIPIENT', 'Sign in with the verified contact this invitation was sent to.');
}
export async function inspectInvitation(actor: AuthenticatedSession, token: string, accept = false) {
  await validateAuthenticatedSession(actor);
  if (accept) await requireRecentAccountAuth(actor);
  const found = await prisma.businessInvitation.findUnique({ where: { tokenHash: tokenDigest(token) } });
  if (!found) throw unavailable();
  return prisma.$transaction(async tx => {
    if (accept) { await lockRecentAccountSession(tx, actor); await lockIdentitySecurity(tx, actor.identity.id); }
    const business = await businessLock(tx, found.businessId);
    const invite = await tx.businessInvitation.findUniqueOrThrow({ where: { id: found.id } });
    await checkInvite(tx, invite, actor);
    // Checked only after the recipient matches, so these messages never reach someone else.
    const staff = invite.staffId ? await lockStaff(tx, business.id, invite.staffId) : null;
    if (invite.staffId) {
      if (!staff) throw new AppError(409, INVITATION_STAFF_REMOVED, 'The calendar this invitation was for was removed. Ask the business for a new invitation.');
      const holder = await linkedAccount(tx, business.id, invite.staffId);
      const own = await tx.membership.findFirst({ where: { businessId: business.id, identityId: actor.identity.id, status: 'ACTIVE', staffId: { not: null } }, select: { id: true } });
      if (holder || own) throw new AppError(409, INVITATION_STAFF_LINKED, 'This calendar, or your account, is already linked in this business. Ask the business to check app access.');
      // An owner's access can never be removed (no last-owner lockout), so a calendar linked to an owner could never be unlinked or removed.
      if (await tx.membership.count({ where: { businessId: business.id, identityId: actor.identity.id, status: 'ACTIVE', role: 'OWNER' } })) throw new AppError(409, INVITATION_OWNER_LINK, 'You own this business, so your account is not linked to a calendar. Ask for an invitation for someone else.');
    }
    const preview = { business: { id: business.id, name: business.name }, role: invite.role, staff: staff ? { displayName: staff.displayName } : null };
    if (!accept) return { ...preview, expiresAt: invite.expiresAt };
    // One membership per person per business. An active member's invitation only links a calendar and never changes
    // their switches, which only the owner changes (the user's call, decisions.md "Switches"). A removed one comes back
    // with this invitation's preset and link, so a revoked calendar link or old switches are never revived.
    const key = { identityId: actor.identity.id, businessId: business.id };
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "identityId" = ${key.identityId} AND "businessId" = ${key.businessId} FOR UPDATE`;
    const existing = await tx.membership.findUnique({ where: { identityId_businessId: key }, select: { status: true } });
    if (existing?.status === 'ACTIVE' && !invite.staffId) throw new AppError(409, INVITATION_ALREADY_MEMBER, 'You are already a member of this business. Ask the owner to change your permissions.');
    if (existing?.status === 'PENDING') throw unavailable();
    const membership = existing?.status === 'ACTIVE'
      ? await tx.membership.update({ where: { identityId_businessId: key }, data: { staffId: invite.staffId } })
      : await tx.membership.upsert({ where: { identityId_businessId: key }, create: { ...key, ...memberPreset(presetOf(invite.role)), status: 'ACTIVE', staffId: invite.staffId }, update: { ...memberPreset(presetOf(invite.role)), status: 'ACTIVE', staffId: invite.staffId } });
    await tx.businessInvitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date(), acceptedByIdentityId: actor.identity.id } });
    await tx.businessAccessEvent.create({ data: { businessId: business.id, membershipId: membership.id, subjectIdentityId: actor.identity.id, actorIdentityId: actor.identity.id, role: membership.role, switches: switchesOf(membership), action: 'JOINED', referenceId: invite.id } });
    return { accepted: true, ...preview };
  });
}
export async function revokeMember(actor: AuthenticatedSession, businessId: string, id: string) {
  const result = await mutation(actor, businessId, async (tx, current) => {
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
    const member = await tx.membership.findFirst({ where: { id, businessId } });
    if (!member) throw notFound();
    if (!permittedRemove(current, member)) throw forbidden();
    if (member.status !== 'ACTIVE') return { revoked: true };
    await tx.membership.update({ where: { id: member.id }, data: { status: 'REVOKED' } });
    await tx.businessInvitation.updateMany({ where: { inviterMembershipId: member.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date(), revokedByIdentityId: actor.identity.id } });
    await tx.businessAccessEvent.create({ data: { businessId, membershipId: member.id, subjectIdentityId: member.identityId, actorIdentityId: actor.identity.id, role: member.role, switches: switchesOf(member), action: 'REVOKED' } });
    return { revoked: true };
  });
  // Nothing else wakes a quiet stream, and the recheck before delivery is what ends this member's.
  signalAgendaChanged(businessId);
  return result;
}
/** Only the owner changes switches, never their own, and never another owner's (decisions.md, "Member privileges design"). */
const mayChangeSwitches = (actor: Membership, member: Membership) => memberHas(actor, BusinessPermission.CHANGE_SWITCHES) && member.role !== 'OWNER' && member.identityId !== actor.identityId;
export const SWITCHES_ACT_NEEDS_SEE = 'SWITCHES_ACT_NEEDS_SEE';
/**
 * Sets a member's four switches. Acting on other calendars needs seeing them, so that pair is refused rather than
 * fixed silently. The member's next read uses the new switches: every check reads the row again.
 */
export async function changeSwitches(actor: AuthenticatedSession, businessId: string, id: string, switches: MemberSwitches) {
  if (switches.actOnAllCalendars && !switches.seeAllCalendars) throw new AppError(400, SWITCHES_ACT_NEEDS_SEE, 'Acting on other calendars needs seeing them.');
  const result = await mutation(actor, businessId, async (tx, current) => {
    if (!memberHas(current, BusinessPermission.CHANGE_SWITCHES)) throw forbidden();
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
    const member = await tx.membership.findFirst({ where: { id, businessId, status: 'ACTIVE' } });
    if (!member) throw notFound();
    if (!mayChangeSwitches(current, member)) throw forbidden();
    const updated = await tx.membership.update({ where: { id: member.id }, data: switchesOf(switches) });
    await tx.businessAccessEvent.create({ data: { businessId, membershipId: member.id, subjectIdentityId: member.identityId, actorIdentityId: actor.identity.id, role: member.role, action: 'SWITCHES_CHANGED', switches: { before: switchesOf(member), after: switchesOf(switches) } } });
    return { id: updated.id, switches: switchesOf(updated) };
  });
  // A member who lost "see" has their live stream ended by the recheck before delivery.
  signalAgendaChanged(businessId);
  return result;
}
async function admin(tx: Prisma.TransactionClient, actor: AuthenticatedSession) {
  if ((await tx.identity.findUnique({ where: { id: actor.identity.id } }))?.platformRole !== 'ADMIN') throw forbidden();
}
export async function ownershipCases(actor: AuthenticatedSession) {
  await requireRecentAccountAuth(actor);
  return prisma.$transaction(async tx => { await lockRecentAccountSession(tx, actor); await lockIdentitySecurity(tx, actor.identity.id); await admin(tx, actor); return { cases: await tx.businessOwnershipReview.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { business: { select: { name: true } } } }) }; });
}
export async function createOwnershipCase(actor: AuthenticatedSession, input: { businessId: string; claimantIdentityId: string; caseReference: string; evidenceKind: string; evidenceSummary: string }) {
  await requireRecentAccountAuth(actor);
  return prisma.$transaction(async tx => {
    await lockRecentAccountSession(tx, actor); for (const id of [...new Set([actor.identity.id, input.claimantIdentityId])].sort()) await lockIdentitySecurity(tx, id); await admin(tx, actor);
    if (input.claimantIdentityId === actor.identity.id) throw forbidden();
    await businessLock(tx, input.businessId);
    const claimant = await tx.identity.findUnique({ where: { id: input.claimantIdentityId } });
    if (!claimant || !(claimant.emailVerifiedAt || claimant.phoneVerifiedAt)) throw conflict('The claimant must have a verified contact.');
    const existing = await tx.businessOwnershipReview.findUnique({ where: { caseReference: input.caseReference } });
    if (existing) throw conflict('This evidence case reference already exists.');
    return tx.businessOwnershipReview.create({ data: { ...input, createdByIdentityId: actor.identity.id, claimantSecurityVersion: claimant.securityVersion } });
  });
}
export async function decideOwnership(actor: AuthenticatedSession, id: string, decision: 'APPROVED' | 'REJECTED', reason: string) {
  await requireRecentAccountAuth(actor);
  if (actor.identity.platformRole !== 'ADMIN') throw forbidden();
  const original = await prisma.businessOwnershipReview.findUnique({ where: { id } });
  if (!original) throw notFound();
  return prisma.$transaction(async tx => {
    await lockRecentAccountSession(tx, actor); for (const id of [...new Set([actor.identity.id, original.claimantIdentityId])].sort()) await lockIdentitySecurity(tx, id); await admin(tx, actor);
    if (actor.identity.id === original.claimantIdentityId) throw forbidden();
    await businessLock(tx, original.businessId);
    await tx.$queryRaw`SELECT id FROM "BusinessOwnershipReview" WHERE id = ${id} FOR UPDATE`;
    const item = await tx.businessOwnershipReview.findUniqueOrThrow({ where: { id } });
    if (item.status !== 'PENDING') throw conflict('This ownership case was already decided.');
    const claimant = await tx.identity.findUniqueOrThrow({ where: { id: item.claimantIdentityId } });
    if (decision === 'APPROVED') {
      if (claimant.securityVersion !== item.claimantSecurityVersion || !(claimant.emailVerifiedAt || claimant.phoneVerifiedAt)) throw conflict('Claimant identity changed. Open a new verified evidence case.');
      // One membership per person: a member who becomes owner is that same row. An owner is never linked to a calendar
      // (decisions.md, "Invitations tied to a staff row"), so the link goes; the database turns all four switches on.
      const member = await tx.membership.upsert({ where: { identityId_businessId: { identityId: claimant.id, businessId: item.businessId } }, create: { identityId: claimant.id, businessId: item.businessId, role: 'OWNER', status: 'ACTIVE' }, update: { role: 'OWNER', status: 'ACTIVE', staffId: null } });
      await tx.businessAccessEvent.create({ data: { businessId: item.businessId, membershipId: member.id, subjectIdentityId: claimant.id, actorIdentityId: actor.identity.id, role: 'OWNER', action: 'OWNER_GRANTED', referenceId: id } });
    }
    return tx.businessOwnershipReview.update({ where: { id }, data: { status: decision, reason, reviewedAt: new Date(), reviewedByIdentityId: actor.identity.id } });
  });
}

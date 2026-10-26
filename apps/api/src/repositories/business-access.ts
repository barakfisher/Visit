import { createHmac } from 'node:crypto';
import { prisma } from '../db/client.js';
import { env } from '../env.js';
import { AppError, conflict, forbidden, notFound } from '../http/errors.js';
import type { Prisma, MembershipRole, BusinessInvitation } from '../generated/prisma/client.js';
import { lockIdentitySecurity, lockRecentAccountSession, requireRecentAccountAuth } from '../security/account-security.js';
import { newOpaqueToken, tokenDigest, validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { ensureRedisReady, redis } from '../infra/redis.js';

export const permittedInvite = (actor: MembershipRole, role: MembershipRole) => actor === 'OWNER' ? role === 'MANAGER' || role === 'STAFF' : actor === 'MANAGER' && role === 'STAFF';
export const recipientDigest = (channel: string, recipient: string) => createHmac('sha256', env.SESSION_SECRET).update(`business-invite:${channel}:${recipient}`).digest('hex');
export function normalizeRecipient(channel: 'email' | 'phone', value: string) {
  const normalized = value.trim();
  if (channel === 'phone') {
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new AppError(400, 'VALIDATION_ERROR', 'Use a phone number with country code.');
    return normalized;
  }
  return normalized.toLowerCase();
}
const unavailable = () => new AppError(409, 'INVITATION_UNAVAILABLE', 'This invitation is unavailable. Request a new invitation.');
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
  const memberships = await tx.membership.findMany({ where: { identityId, businessId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } } });
  const membership = memberships.find(m => m.role === 'OWNER') ?? memberships[0];
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
    const allMembers = await tx.membership.findMany({ where: { businessId, status: 'ACTIVE' }, select: { id: true, role: true, identityId: true, identity: { select: { email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } } }, orderBy: { createdAt: 'asc' } });
    const strongest = new Map<string, (typeof allMembers)[number]>();
    const rank = { OWNER: 3, MANAGER: 2, STAFF: 1 };
    for (const member of allMembers) if (!strongest.has(member.identityId) || rank[member.role] > rank[strongest.get(member.identityId)!.role]) strongest.set(member.identityId, member);
    const members = [...strongest.values()].map(({ identity, ...member }) => ({ ...member, label: identity.email && identity.emailVerifiedAt ? `${identity.email.slice(0, 1)}***@${identity.email.split('@')[1]}` : identity.phone && identity.phoneVerifiedAt ? `***${identity.phone.slice(-4)}` : '—' }));
    return { role: current.role, members, invitations: await tx.businessInvitation.findMany({ where: { businessId }, select: { id: true, role: true, recipientHint: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });
}
export async function createInvitation(actor: AuthenticatedSession, businessId: string, input: { role: 'MANAGER' | 'STAFF'; channel: 'email' | 'phone'; recipient: string }) {
  await requireRecentAccountAuth(actor); await limit(actor);
  const recipient = normalizeRecipient(input.channel, input.recipient), digest = recipientDigest(input.channel, recipient);
  const token = newOpaqueToken();
  const invitation = await mutation(actor, businessId, async (tx, member) => {
    if (!permittedInvite(member.role, input.role)) throw forbidden();
    const now = new Date();
    // A lost creation response is recovered by issuing a new link, never storing its secret.
    await tx.businessInvitation.updateMany({ where: { businessId, recipientDigest: digest, role: input.role, acceptedAt: null, revokedAt: null }, data: { revokedAt: now, revokedByIdentityId: actor.identity.id } });
    if (await tx.businessInvitation.count({ where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }) >= 100) throw conflict('Revoke unused invitations before creating more.');
    return tx.businessInvitation.create({ data: { businessId, inviterIdentityId: actor.identity.id, inviterMembershipId: member.id, inviterRole: member.role, role: input.role, recipientChannel: input.channel, recipientDigest: digest, recipientHint: input.channel === 'email' ? `${recipient.slice(0, 1)}***@${recipient.split('@')[1]}` : `***${recipient.slice(-4)}`, tokenHash: tokenDigest(token), expiresAt: new Date(now.getTime() + 72 * 3600000) } });
  });
  return { id: invitation.id, expiresAt: invitation.expiresAt, url: `${env.WEB_APP_URL.replace(/\/$/, '')}/invite#invite=${token}` };
}
export async function revokeInvitation(actor: AuthenticatedSession, businessId: string, id: string) {
  return mutation(actor, businessId, async (tx, member) => {
    const invite = await tx.businessInvitation.findFirst({ where: { id, businessId } });
    if (!invite) throw notFound();
    if (!permittedInvite(member.role, invite.role)) throw forbidden();
    if (invite.acceptedAt) throw conflict('This invitation was already accepted. Manage the membership instead.');
    if (!invite.revokedAt) await tx.businessInvitation.update({ where: { id }, data: { revokedAt: new Date(), revokedByIdentityId: actor.identity.id } });
    return { revoked: true };
  });
}
async function checkInvite(tx: Prisma.TransactionClient, invite: BusinessInvitation, actor: AuthenticatedSession) {
  if (invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) throw unavailable();
  const member = await tx.membership.findUnique({ where: { id: invite.inviterMembershipId } });
  if (!member || member.status !== 'ACTIVE' || member.role !== invite.inviterRole || !permittedInvite(member.role, invite.role)) throw unavailable();
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
    if (!accept) return { business: { id: business.id, name: business.name }, role: invite.role, expiresAt: invite.expiresAt };
    const membership = await tx.membership.upsert({ where: { identityId_businessId_role: { identityId: actor.identity.id, businessId: business.id, role: invite.role } }, create: { identityId: actor.identity.id, businessId: business.id, role: invite.role, status: 'ACTIVE' }, update: { status: 'ACTIVE' } });
    await tx.businessInvitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date(), acceptedByIdentityId: actor.identity.id } });
    await tx.businessAccessEvent.create({ data: { businessId: business.id, membershipId: membership.id, subjectIdentityId: actor.identity.id, actorIdentityId: actor.identity.id, role: invite.role, action: 'JOINED', referenceId: invite.id } });
    return { accepted: true, business: { id: business.id, name: business.name }, role: invite.role };
  });
}
export async function revokeMember(actor: AuthenticatedSession, businessId: string, id: string) {
  return mutation(actor, businessId, async (tx, current) => {
    const member = await tx.membership.findFirst({ where: { id, businessId } });
    if (!member) throw notFound();
    // Revoke all subordinate roles of this identity so a hidden lower role cannot retain access.
    const roles = await tx.membership.findMany({ where: { identityId: member.identityId, businessId, status: 'ACTIVE' } });
    if (!permittedInvite(current.role, member.role) || roles.some(m => !permittedInvite(current.role, m.role))) throw forbidden();
    for (const role of roles) {
      await tx.membership.update({ where: { id: role.id }, data: { status: 'REVOKED' } });
      await tx.businessInvitation.updateMany({ where: { inviterMembershipId: role.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date(), revokedByIdentityId: actor.identity.id } });
      await tx.businessAccessEvent.create({ data: { businessId, membershipId: role.id, subjectIdentityId: role.identityId, actorIdentityId: actor.identity.id, role: role.role, action: 'REVOKED' } });
    }
    return { revoked: true };
  });
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
      const member = await tx.membership.upsert({ where: { identityId_businessId_role: { identityId: claimant.id, businessId: item.businessId, role: 'OWNER' } }, create: { identityId: claimant.id, businessId: item.businessId, role: 'OWNER', status: 'ACTIVE' }, update: { status: 'ACTIVE' } });
      await tx.businessAccessEvent.create({ data: { businessId: item.businessId, membershipId: member.id, subjectIdentityId: claimant.id, actorIdentityId: actor.identity.id, role: 'OWNER', action: 'OWNER_GRANTED', referenceId: id } });
    }
    return tx.businessOwnershipReview.update({ where: { id }, data: { status: decision, reason, reviewedAt: new Date(), reviewedByIdentityId: actor.identity.id } });
  });
}

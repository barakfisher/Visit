import { AppError } from '../http/errors.js';
import type { Prisma, Identity, Session } from '../generated/prisma/client.js';
import { newOpaqueToken, sessionExpiry, tokenDigest, validateAuthenticatedSession, type AuthenticatedSession } from './sessions.js';

export const reauthRequired = () => new AppError(401, 'REAUTH_REQUIRED', 'Sign in again before changing sign-in settings.');
export const methodUnavailable = () => new AppError(409, 'METHOD_UNAVAILABLE', 'This sign-in method cannot be used. Try another method or request reviewed account recovery.');
export async function requireRecentAccountAuth(actor: AuthenticatedSession, now = new Date()) {
  await validateAuthenticatedSession(actor);
  if (actor.authenticatedAt > now || now.getTime() - actor.authenticatedAt.getTime() > 300000) throw reauthRequired();
}
export async function lockIdentitySecurity(tx: Prisma.TransactionClient, identityId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`identity-security:${identityId}`}, 0))::text`;
}
export async function lockRecentAccountSession(tx: Prisma.TransactionClient, actor: AuthenticatedSession, now = new Date()) {
  const original = await tx.session.findUnique({ where: { id: actor.sessionId }, select: { familyId: true } });
  if (!original) throw reauthRequired();
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${original.familyId}, 0))::text`;
  const session = await tx.session.findFirst({ where: { id: actor.sessionId, identityId: actor.identity.id, revokedAt: null, expiresAt: { gt: now }, refreshExpiresAt: { gt: now }, authenticatedAt: { gte: new Date(now.getTime() - 300000), lte: now } } });
  if (!session) throw reauthRequired();
  return session;
}
export async function previousSecurityChannels(tx: Prisma.TransactionClient, identity: Identity) {
  const channels: { channel: 'email' | 'phone'; destination: string }[] = [];
  if (identity.email && identity.emailVerifiedAt) channels.push({ channel: 'email', destination: identity.email });
  if (identity.phone && identity.phoneVerifiedAt) channels.push({ channel: 'phone', destination: identity.phone });
  // A linked Google address was verified by Google; use it if no primary email exists.
  if (!channels.some(value => value.channel === 'email')) {
    const google = await tx.externalIdentity.findMany({ where: { identityId: identity.id, provider: 'google' }, select: { email: true } });
    for (const value of google) if (value.email && !channels.some(item => item.destination === value.email)) channels.push({ channel: 'email', destination: value.email });
  }
  return channels;
}
/** Acquire before any unique primary-contact update, whose row lock can block refresh FK checks. */
export async function lockIdentitySessionFamilies(tx: Prisma.TransactionClient, identityId: string) {
  const families = await tx.session.findMany({ where: { identityId: identityId, revokedAt: null }, distinct: ['familyId'], select: { familyId: true }, orderBy: { familyId: 'asc' } });
  for (const family of families) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${family.familyId}, 0))::text`;
}
/** Caller holds resource locks, identity lock and has rechecked the current session. */
export async function finishAccountSecurityChange(tx: Prisma.TransactionClient, input: {
  identity: Identity; session: Session; action: 'LINKED' | 'REPLACED' | 'REMOVED'; method: 'email' | 'phone' | 'google';
  notificationScope?: string; channels: { channel: 'email' | 'phone'; destination: string }[]; rotate: boolean; proofHash?: string;
}, now = new Date()) {
  const { identity, session } = input;
  await lockIdentitySessionFamilies(tx, identity.id);
  const current = await tx.session.findFirst({ where: { id: session.id, identityId: identity.id, revokedAt: null, expiresAt: { gt: now } } });
  if (!current) throw reauthRequired();
  await tx.session.updateMany({ where: { identityId: identity.id, revokedAt: null, ...(input.rotate ? {} : { familyId: { not: session.familyId } }) }, data: { revokedAt: now } });
  await tx.identity.update({ where: { id: identity.id }, data: { securityVersion: { increment: 1 } } });
  await tx.accountContactChallenge.updateMany({ where: { identityId: identity.id, consumedAt: null }, data: { consumedAt: now } });
  await tx.emailChallenge.updateMany({ where: { consumedAt: null, OR: [{ identityId: identity.id }, ...(identity.email ? [{ email: identity.email }] : [])] }, data: { consumedAt: now } });
  const event = await tx.identitySecurityEvent.create({ data: { identityId: identity.id, action: input.action, method: input.method } });
  if (input.channels.length) await tx.securityNotification.createMany({ data: input.channels.map(channel => ({ identityId: identity.id, eventId: event.id, scope: input.notificationScope ?? 'live', ...channel })) });
  if (!input.rotate) return { identityId: identity.id };
  const token = newOpaqueToken();
  await tx.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Math.min(sessionExpiry(now).getTime(), session.refreshExpiresAt.getTime())), refreshExpiresAt: session.refreshExpiresAt, authenticatedAt: session.authenticatedAt, ...(input.proofHash ? { authenticationProofHash: input.proofHash } : {}) } });
  return { identityId: identity.id, sessionToken: token, refreshExpiresAt: session.refreshExpiresAt };
}
export async function usableMethodCount(tx: Prisma.TransactionClient, identity: Identity) {
  return Number(Boolean(identity.email && identity.emailVerifiedAt)) + Number(Boolean(identity.phone && identity.phoneVerifiedAt)) + await tx.externalIdentity.count({ where: { identityId: identity.id, provider: 'google' } });
}

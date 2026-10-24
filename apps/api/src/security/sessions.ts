import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db/client.js';
import { unauthenticated } from '../http/errors.js';
import { env } from '../env.js';
import type { Identity } from '../generated/prisma/client.js';

const sessionCookieName = () => env.NODE_ENV === 'production' ? '__Host-visit_session' : 'visit_session';
const SESSION_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sessionBrand: unique symbol = Symbol('AuthenticatedSession');
const issuedSessions = new WeakSet<object>();
export type AuthenticatedSession = Readonly<{
  sessionId: string;
  authenticatedAt: Date;
  identity: Readonly<Pick<Identity, 'id' | 'email' | 'emailVerifiedAt' | 'platformRole'>>;
  [sessionBrand]: true;
}>;

export function newOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieToken(request: FastifyRequest) {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== sessionCookieName()) continue;
    try { return decodeURIComponent(pair.slice(separator + 1).trim()); } catch { throw unauthenticated(); }
  }
  return undefined;
}

export function readSessionToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return cookieToken(request);
}

export async function authenticate(request: FastifyRequest) {
  const rawToken = readSessionToken(request);
  if (!rawToken) throw unauthenticated();
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenDigest(rawToken) },
    select: {
      id: true,
      identityId: true,
      authenticatedAt: true,
      expiresAt: true,
      revokedAt: true,
      identity: { select: { id: true, email: true, emailVerifiedAt: true, platformRole: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw unauthenticated();
  const context = Object.freeze({ sessionId: session.id, authenticatedAt: session.authenticatedAt, identity: Object.freeze(session.identity), [sessionBrand]: true as const });
  issuedSessions.add(context);
  return context;
}

export async function validateAuthenticatedSession(context: AuthenticatedSession) {
  if (!context || !issuedSessions.has(context)) throw unauthenticated();
  const session = await prisma.session.findFirst({ where: { id: context.sessionId, identityId: context.identity.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  if (!session) throw unauthenticated();
}

export function issueSessionToken(reply: FastifyReply, request: FastifyRequest, rawToken: string, refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS)) {
  const isNative = request.headers['x-visit-client'] === 'native' && !request.headers.origin && !request.headers.cookie && !request.headers['sec-fetch-site'];
  const maxAge = Math.max(0, Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000));
  const expiresInSeconds = Math.floor(SESSION_TTL_MS / 1000);
  if (isNative) return { sessionToken: rawToken, expiresInSeconds };

  reply.header('set-cookie', `${sessionCookieName()}=${encodeURIComponent(rawToken)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return { expiresInSeconds };
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header('set-cookie', `${sessionCookieName()}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

export const sessionExpiry = (from = new Date()) => new Date(from.getTime() + SESSION_TTL_MS);

/** Serialize every rotation/logout/replay decision in this login family. */
export async function rotateSession(rawToken: string) {
  const digest = tokenDigest(rawToken);
  const original = await prisma.session.findUnique({ where: { tokenHash: digest }, select: { familyId: true } });
  if (!original) throw unauthenticated();
  const replacement = newOpaqueToken();
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${original.familyId}, 0))::text`;
    const existing = await tx.session.findUnique({ where: { tokenHash: digest }, include: { identity: { select: { id: true, email: true, platformRole: true } } } });
    if (!existing) return null;
    if (existing.revokedAt) {
      // Commit revocation before returning 401; throwing here would roll it back.
      await tx.session.updateMany({ where: { familyId: existing.familyId, identityId: existing.identityId, revokedAt: null }, data: { revokedAt: new Date() } });
      return null;
    }
    if (existing.refreshExpiresAt <= new Date()) return null;
    const session = await tx.session.create({ data: { identityId: existing.identityId, familyId: existing.familyId, authenticatedAt: existing.authenticatedAt, refreshExpiresAt: existing.refreshExpiresAt, tokenHash: tokenDigest(replacement), expiresAt: new Date(Math.min(sessionExpiry().getTime(), existing.refreshExpiresAt.getTime())) } });
    await tx.session.update({ where: { id: existing.id }, data: { revokedAt: new Date(), replacedById: session.id } });
    return { session, identity: existing.identity };
  }, { maxWait: 5000, timeout: 5000 });
  if (!result) throw unauthenticated();
  return { ...result, token: replacement };
}

export async function revokeSessionFamily(context: AuthenticatedSession) {
  if (!context || !issuedSessions.has(context)) throw unauthenticated();
  const session = await prisma.session.findUnique({ where: { id: context.sessionId }, select: { familyId: true } });
  if (!session) return;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${session.familyId}, 0))::text`;
    await tx.session.updateMany({ where: { familyId: session.familyId, identityId: context.identity.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

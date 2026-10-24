import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db/client.js';
import { unauthenticated } from '../http/errors.js';
import { env } from '../env.js';

const SESSION_COOKIE = 'visit_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    if (separator < 0 || pair.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
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
      expiresAt: true,
      revokedAt: true,
      identity: { select: { id: true, email: true, emailVerifiedAt: true, platformRole: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw unauthenticated();
  return { sessionId: session.id, identity: session.identity };
}

export function issueSessionToken(reply: FastifyReply, request: FastifyRequest, rawToken: string) {
  const isNative = request.headers['x-visit-client'] === 'native';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  if (isNative) return { sessionToken: rawToken, expiresInSeconds: maxAge };

  reply.header('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return { expiresInSeconds: maxAge };
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header('set-cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

export const sessionExpiry = (from = new Date()) => new Date(from.getTime() + SESSION_TTL_MS);

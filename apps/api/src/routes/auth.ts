import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { env } from '../env.js';
import { AppError, unauthenticated } from '../http/errors.js';
import { ensureRedisReady, redis } from '../infra/redis.js';
import { authenticate, clearSessionCookie, issueSessionToken, newOpaqueToken, sessionExpiry, tokenDigest, readSessionToken, rotateSession, revokeSessionFamily } from '../security/sessions.js';
import { PlatformRole } from '../generated/prisma/client.js';

const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const mailbox = new Map<string, { token: string; expiresAt: number }>();
const challengeLifetimeMs = 15 * 60 * 1000;

async function rateLimit(key: string, maximum: number, seconds: number) {
  try {
    await ensureRedisReady();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, seconds);
    if (count > maximum) throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-in is temporarily unavailable. Please retry shortly.');
  }
}

async function sendLoginEmail(email: string, token: string) {
  const url = new URL('/auth', env.WEB_APP_URL);
  url.searchParams.set('token', token);
  if (env.EMAIL_DELIVERY_MODE === 'local-inbox') {
    mailbox.set(email, { token, expiresAt: Date.now() + challengeLifetimeMs });
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: 'Your Visit sign-in link',
      html: `<p>Sign in to Visit</p><p><a href="${url.toString()}">Continue to Visit</a></p><p>This link expires in 15 minutes and can be used once.</p>`,
    }),
  });
  if (!response.ok) throw new AppError(503, 'EMAIL_DELIVERY_FAILED', 'Sign-in email could not be sent. Please retry shortly.');
}

function sessionView(reply: Parameters<typeof issueSessionToken>[0], request: Parameters<typeof issueSessionToken>[1], rawToken: string, identity: { id: string; email: string | null; platformRole: string }) {
  return { ...issueSessionToken(reply, request, rawToken), identity };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/v1/auth/email-challenges', async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid email address.', { email: 'Enter a valid email address.' });
    const email = parsed.data.email;
    const emailKey = createHash('sha256').update(email).digest('hex');
    await Promise.all([
      rateLimit(`auth:email:ip:${request.ip}`, 10, 60 * 60),
      rateLimit(`auth:email:address:${emailKey}`, 5, 60 * 60),
    ]);

    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + challengeLifetimeMs);
    const identity = await prisma.identity.findUnique({ where: { email }, select: { id: true } });
    await prisma.emailChallenge.create({ data: { email, ...(identity ? { identityId: identity.id } : {}), tokenHash: tokenDigest(token), expiresAt } });
    try {
      await sendLoginEmail(email, token);
    } catch (error) {
      await prisma.emailChallenge.updateMany({ where: { tokenHash: tokenDigest(token), consumedAt: null }, data: { consumedAt: new Date() } });
      throw error;
    }
    reply.code(202);
    return { accepted: true, message: 'If this address can sign in, a link will arrive shortly.' };
  });

  app.get('/__dev/mailbox', async (request) => {
    if (env.NODE_ENV !== 'development' || env.EMAIL_DELIVERY_MODE !== 'local-inbox') throw new AppError(404, 'NOT_FOUND', 'The requested resource was not found.');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) throw new AppError(403, 'FORBIDDEN', 'This development endpoint is local only.');
    const parsed = z.object({ email: emailSchema }).safeParse(request.query);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'A valid email address is required.');
    const message = mailbox.get(parsed.data.email);
    if (!message || message.expiresAt <= Date.now()) throw new AppError(404, 'NOT_FOUND', 'No unexpired sign-in email is available.');
    mailbox.delete(parsed.data.email);
    return { token: message.token, expiresAt: new Date(message.expiresAt).toISOString() };
  });

  app.post('/v1/auth/email-challenges/verify', async (request, reply) => {
    const parsed = z.object({ token: z.string().min(20).max(256) }).safeParse(request.body);
    if (!parsed.success) throw unauthenticated();
    await rateLimit(`auth:verify:ip:${request.ip}`, 20, 60 * 15);
    const digest = tokenDigest(parsed.data.token);
    const challenge = await prisma.emailChallenge.findUnique({ where: { tokenHash: digest } });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.consumedAt || challenge.purpose !== 'EMAIL_LOGIN') throw unauthenticated();

    const rawSessionToken = newOpaqueToken();
    const configuredAdmins = new Set(env.PLATFORM_ADMIN_EMAILS.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
    const platformRole = configuredAdmins.has(challenge.email) ? PlatformRole.ADMIN : PlatformRole.USER;
    const identity = await prisma.$transaction(async (tx) => {
      const consumed = await tx.emailChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw unauthenticated();

      const person = await tx.identity.upsert({
        where: { email: challenge.email },
        create: { email: challenge.email, emailVerifiedAt: new Date(), platformRole },
        update: { emailVerifiedAt: new Date(), platformRole },
        select: { id: true, email: true, platformRole: true },
      });
      await tx.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(rawSessionToken), expiresAt: sessionExpiry() } });
      return person;
    });
    return sessionView(reply, request, rawSessionToken, identity);
  });

  app.post('/v1/auth/refresh', async (request, reply) => {
    const rawToken = readSessionToken(request);
    if (!rawToken) throw unauthenticated();
    const { session, identity, token } = await rotateSession(rawToken);
    return { ...issueSessionToken(reply, request, token, session.refreshExpiresAt), expiresAt: session.expiresAt.toISOString(), identity };
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const session = await authenticate(request);
    await revokeSessionFamily(session);
    clearSessionCookie(reply);
    return { loggedOut: true };
  });

  app.get('/v1/me', async (request) => {
    const { identity } = await authenticate(request);
    const [memberships, applications] = await Promise.all([
      prisma.membership.findMany({ where: { identityId: identity.id }, select: { role: true, status: true, business: { select: { id: true, name: true, slug: true, approvalStatus: true } } } }),
      prisma.providerApplication.findMany({ where: { identityId: identity.id }, select: { id: true, status: true, business: { select: { id: true, name: true, approvalStatus: true } } } }),
    ]);
    return { identity, memberships, providerApplications: applications };
  });
}

import { safeAuthReturnTo } from '@visit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { env } from '../env.js';
import { AppError, unauthenticated } from '../http/errors.js';
import { authenticate, clearSessionCookie, issueSessionToken, readSessionToken, rotateSession, revokeSessionFamily } from '../security/sessions.js';

import { emailSchema, emailLoginService, type createEmailLoginService } from '../security/email-login.js';
import { passwordLoginService, type createPasswordLoginService } from '../security/password-login.js';

export async function registerAuthRoutes(app: FastifyInstance, { emailLogin = emailLoginService, passwordLogin = passwordLoginService }: { emailLogin?: ReturnType<typeof createEmailLoginService>; passwordLogin?: ReturnType<typeof createPasswordLoginService> } = {}) {
  // Field rules are enforced by the service; the route only bounds the shape before hashing.
  const passwordFields = { email: z.string().max(320), password: z.string().max(1024) };
  app.post('/v1/auth/password/sign-up', async (request, reply) => {
    const parsed = z.strictObject({ ...passwordFields, displayName: z.string().max(512) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your name, email and password.');
    const result = await passwordLogin.signUp(parsed.data, request.ip).catch((error: unknown) => {
      if (error instanceof z.ZodError) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your name, a valid email and a password of at least 8 characters.');
      throw error;
    });
    reply.code(201);
    return { ...issueSessionToken(reply, request, result.token), identity: result.identity };
  });
  app.post('/v1/auth/password/sign-in', async (request, reply) => {
    const parsed = z.strictObject(passwordFields).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your email and password.');
    const result = await passwordLogin.signIn(parsed.data, request.ip);
    return { ...issueSessionToken(reply, request, result.token), identity: result.identity };
  });
  app.post('/v1/auth/email-challenges', async (request, reply) => {
    const parsed = z.strictObject({ email: emailSchema, target: z.enum(['web', 'native']).default('web'), returnTo: z.string().max(512).refine(value => safeAuthReturnTo(value) !== undefined).optional() }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid email address and supported destination.', { email: 'Review the sign-in request.' });
    const result = await emailLogin.send(parsed.data.email, request.ip, parsed.data.target, parsed.data.returnTo);
    reply.code(202);
    return result;
  });

  app.get('/__dev/mailbox', async (request) => {
    if (env.NODE_ENV !== 'development' || emailLogin.deliveryMode !== 'local-inbox') throw new AppError(404, 'NOT_FOUND', 'The requested resource was not found.');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) throw new AppError(403, 'FORBIDDEN', 'This development endpoint is local only.');
    const parsed = z.object({ email: emailSchema }).safeParse(request.query);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'A valid email address is required.');
    return emailLogin.localMessage(parsed.data.email);
  });

  app.post('/v1/auth/email-challenges/verify', async (request, reply) => {
    const parsed = z.strictObject({ token: z.string().min(20).max(256) }).safeParse(request.body);
    if (!parsed.success) throw unauthenticated();
    const result = await emailLogin.verify(parsed.data.token, request.ip);
    return { ...issueSessionToken(reply, request, result.token), identity: result.identity };
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
    // displayName prefills "Add myself" in staff settings; publishedAt tells Home whether a managed business is open yet.
    const [profile, memberships, applications] = await Promise.all([
      prisma.identity.findUniqueOrThrow({ where: { id: identity.id }, select: { displayName: true } }),
      prisma.membership.findMany({ where: { identityId: identity.id }, select: { role: true, status: true, business: { select: { id: true, name: true, slug: true, approvalStatus: true, publishedAt: true } } } }),
      prisma.providerApplication.findMany({ where: { identityId: identity.id }, select: { id: true, status: true, business: { select: { id: true, name: true, approvalStatus: true } } } }),
    ]);
    return { identity: { ...identity, displayName: profile.displayName }, memberships, providerApplications: applications };
  });
}

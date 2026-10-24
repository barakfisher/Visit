import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { googleAuthService, registerGoogleRoutes } from './google-auth.js';
import { env } from '../env.js';
import { prisma } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { authenticate, newOpaqueToken, issueSessionToken, sessionExpiry, tokenDigest } from '../security/sessions.js';

import { phoneSchema as phone, otpService, type createOtpService } from '../security/phone-otp.js';
const phoneKey = (value: string) => createHash('sha256').update(value).digest('hex');
export async function authProfile(identityId: string) {
  const identity = await prisma.identity.findUniqueOrThrow({ where: { id: identityId }, select: { id: true, email: true, phone: true, preferredLocale: true, memberships: { where: { status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] }, business: { approvalStatus: 'APPROVED' } }, select: { business: { select: { id: true, name: true, timezone: true } } } } } });
  return { id: identity.id, email: identity.email, phone: identity.phone, preferredLocale: identity.preferredLocale, is_provider: identity.memberships.length > 0, businesses: identity.memberships.map((membership) => membership.business) };
}
export async function registerFlowAuth(app: FastifyInstance, { otp = otpService, google = googleAuthService }: { otp?: ReturnType<typeof createOtpService>; google?: typeof googleAuthService } = {}) {
  app.put('/api/account/preferences', async (request) => {
    const { identity } = await authenticate(request);
    const { locale } = z.object({ locale: z.enum(['he', 'en']) }).strict().parse(request.body);
    await prisma.identity.update({ where: { id: identity.id }, data: { preferredLocale: locale } });
    return { locale };
  });
  app.get('/api/auth/capabilities', async () => ({ sms: otp.mode !== 'disabled', google: google.enabled, googleNative: google.nativeEnabled, email: true }));
  app.get('/api/auth/me', async (request) => { const { identity } = await authenticate(request); return { profile: await authProfile(identity.id) }; });
  app.post('/api/auth/otp/send', async (request, reply) => {
    const parsed = z.object({ phone }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid international phone number.');
    const result = await otp.send(parsed.data.phone, request.ip);
    reply.code(202);
    return result;
  });
  app.post('/api/auth/otp/verify', async (request, reply) => {
    const parsed = z.object({ phone, code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your phone number and six-digit code.');
    const { phone: verifiedPhone, proofHash } = await otp.verify(parsed.data.phone, parsed.data.code, request.ip);
    const token = newOpaqueToken();
    let identity;
    try {
      identity = await prisma.$transaction(async tx => {
        const person = await tx.identity.upsert({ where: { phone: verifiedPhone }, create: { phone: verifiedPhone, phoneVerifiedAt: new Date() }, update: { phoneVerifiedAt: new Date() } });
        await tx.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), authenticationProofHash: proofHash, expiresAt: sessionExpiry() } });
        return person;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new AppError(401, 'INVALID_OTP', 'This code is invalid or expired. Request a new code.');
      throw error;
    }
    return { ...issueSessionToken(reply, request, token), profile: await authProfile(identity.id) };
  });
  app.get('/__dev/otp', async (request) => {
    if (env.NODE_ENV !== 'development' || env.SMS_DELIVERY_MODE !== 'local-inbox' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const parsed = z.object({ phone }).safeParse(request.query);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a phone number.');
    const challenge = await redis.get(`visit:otp:challenge:${phoneKey(parsed.data.phone)}`);
    if (!challenge || JSON.parse(challenge).attempts >= 5 || JSON.parse(challenge).expiresAt <= Date.now()) throw new AppError(404, 'NOT_FOUND', 'No current local code.');
    const code = await redis.get(`visit:otp:inbox:${phoneKey(parsed.data.phone)}`);
    if (!code) throw new AppError(404, 'NOT_FOUND', 'No current local code.');
    return { code };
  });
  await registerGoogleRoutes(app, { google });
}

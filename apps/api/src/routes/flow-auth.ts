import { lockIdentitySecurity } from '../security/account-security.js';
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
import { BusinessPermission, ROLE_PRIORITY, rolesWith } from '../security/business-permissions.js';
import { countedMembershipWhere } from '../security/tenant-context.js';
const phoneKey = (value: string) => createHash('sha256').update(value).digest('hex');
/**
 * The person and the businesses they open provider mode for. One entry per business, under their strongest role
 * (ROLE_PRIORITY). A worker's entry names the calendar they work on: provider mode then opens their own My day.
 */
export async function authProfile(identityId: string) {
  const identity = await prisma.identity.findUniqueOrThrow({ where: { id: identityId }, select: { id: true, email: true, phone: true, preferredLocale: true, memberships: { where: { status: 'ACTIVE', role: { in: rolesWith(BusinessPermission.WORKSPACE) }, business: { approvalStatus: 'APPROVED' }, ...countedMembershipWhere }, select: { role: true, staff: { select: { id: true, displayName: true, active: true } }, business: { select: { id: true, name: true, timezone: true } } } } } });
  const strongest = new Map<string, typeof identity.memberships[number]>();
  for (const role of ROLE_PRIORITY) for (const membership of identity.memberships) if (membership.role === role && !strongest.has(membership.business.id)) strongest.set(membership.business.id, membership);
  const businesses = [...strongest.values()].map(m => ({ ...m.business, role: m.role, ...(m.role === 'STAFF' && m.staff ? { calendar: m.staff } : {}) }));
  return { id: identity.id, email: identity.email, phone: identity.phone, preferredLocale: identity.preferredLocale, is_provider: businesses.length > 0, businesses };
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
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${verifiedPhone}`}, 0))::text`;
        const existing = await tx.identity.findUnique({ where: { phone: verifiedPhone }, select: { id: true } });
        if (existing) await lockIdentitySecurity(tx, existing.id);
        const person = await tx.identity.upsert({ where: { phone: verifiedPhone }, create: { phone: verifiedPhone, phoneVerifiedAt: new Date() }, update: { phoneVerifiedAt: new Date() } });
        if (!existing) await lockIdentitySecurity(tx, person.id);
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

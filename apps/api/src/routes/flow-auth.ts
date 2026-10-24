import { createHash, createHmac, randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../env.js';
import { prisma } from '../db/client.js';
import { AppError, unauthenticated } from '../http/errors.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { authenticate, newOpaqueToken, issueSessionToken, sessionExpiry, tokenDigest } from '../security/sessions.js';

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number, for example +972501234567.');
const phoneKey = (value: string) => createHash('sha256').update(value).digest('hex');
const codeHash = (value: string, code: string) => createHmac('sha256', env.SESSION_SECRET).update(`${value}:${code}`).digest('hex');
async function limit(key: string, max: number, ttl: number) {
  await ensureRedisReady();
  const count = await redis.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, `visit:otp:limit:${key}`, ttl);
  if (Number(count) > max) throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
}
export async function authProfile(identityId: string) {
  const identity = await prisma.identity.findUniqueOrThrow({ where: { id: identityId }, select: { id: true, email: true, phone: true, preferredLocale: true, memberships: { where: { status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] }, business: { approvalStatus: 'APPROVED' } }, select: { business: { select: { id: true, name: true, timezone: true } } } } } });
  return { id: identity.id, email: identity.email, phone: identity.phone, preferredLocale: identity.preferredLocale, is_provider: identity.memberships.length > 0, businesses: identity.memberships.map((membership) => membership.business) };
}
async function login(identityId: string, reply: FastifyReply, request: FastifyRequest) {
  const token = newOpaqueToken();
  await prisma.session.create({ data: { identityId, tokenHash: tokenDigest(token), expiresAt: sessionExpiry() } });
  return { ...issueSessionToken(reply, request, token), profile: await authProfile(identityId) };
}
async function twilio(path: string, values: Record<string, string>) {
  const response = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${path}`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new AppError(503, 'SMS_UNAVAILABLE', 'SMS verification is temporarily unavailable.');
  return response.json() as Promise<{ status: string }>;
}
export async function registerFlowAuth(app: FastifyInstance) {
  app.put('/api/account/preferences', async (request) => {
    const { identity } = await authenticate(request);
    const { locale } = z.object({ locale: z.enum(['he', 'en']) }).strict().parse(request.body);
    await prisma.identity.update({ where: { id: identity.id }, data: { preferredLocale: locale } });
    return { locale };
  });
  app.get('/api/auth/capabilities', async () => ({ sms: env.SMS_DELIVERY_MODE !== 'disabled', google: Boolean(env.GOOGLE_CLIENT_IDS), email: true }));
  app.get('/api/auth/me', async (request) => { const { identity } = await authenticate(request); return { profile: await authProfile(identity.id) }; });
  app.post('/api/auth/otp/send', async (request, reply) => {
    const parsed = z.object({ phone }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid international phone number.');
    if (env.SMS_DELIVERY_MODE === 'disabled') throw new AppError(503, 'SMS_NOT_CONFIGURED', 'Phone sign-in is not available yet.');
    await Promise.all([limit(`ip:${phoneKey(request.ip)}`, 10, 3600), limit(`phone:${phoneKey(parsed.data.phone)}`, 5, 600)]);
    if (env.SMS_DELIVERY_MODE === 'twilio') await twilio('Verifications', { To: parsed.data.phone, Channel: 'sms' });
    else {
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      await redis.set(`visit:otp:${phoneKey(parsed.data.phone)}`, codeHash(parsed.data.phone, code), 'EX', 300);
      await redis.set(`visit:otp:inbox:${phoneKey(parsed.data.phone)}`, code, 'EX', 300);
    }
    reply.code(202);
    return { accepted: true, expiresInSeconds: 300 };
  });
  app.post('/api/auth/otp/verify', async (request, reply) => {
    const parsed = z.object({ phone, code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your phone number and six-digit code.');
    if (env.SMS_DELIVERY_MODE === 'disabled') throw new AppError(503, 'SMS_NOT_CONFIGURED', 'Phone sign-in is not available yet.');
    await Promise.all([limit(`verify:${phoneKey(parsed.data.phone)}`, 8, 300), limit(`verify-ip:${phoneKey(request.ip)}`, 30, 900)]);
    let valid = false;
    if (env.SMS_DELIVERY_MODE === 'twilio') valid = (await twilio('VerificationCheck', { To: parsed.data.phone, Code: parsed.data.code })).status === 'approved';
    else valid = await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 end return 0", 1, `visit:otp:${phoneKey(parsed.data.phone)}`, codeHash(parsed.data.phone, parsed.data.code)) === 1;
    if (!valid) throw new AppError(401, 'INVALID_OTP', 'This code is invalid or expired. Request a new code.');
    const identity = await prisma.identity.upsert({ where: { phone: parsed.data.phone }, create: { phone: parsed.data.phone }, update: {} });
    return login(identity.id, reply, request);
  });
  app.get('/__dev/otp', async (request) => {
    if (env.NODE_ENV !== 'development' || env.SMS_DELIVERY_MODE !== 'local-inbox' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const parsed = z.object({ phone }).safeParse(request.query);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a phone number.');
    const code = await redis.get(`visit:otp:inbox:${phoneKey(parsed.data.phone)}`);
    if (!code) throw new AppError(404, 'NOT_FOUND', 'No current local code.');
    return { code };
  });
  app.post('/api/auth/google', async (request, reply) => {
    if (!env.GOOGLE_CLIENT_IDS) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not available yet.');
    const parsed = z.object({ idToken: z.string().min(100).max(10000) }).safeParse(request.body);
    if (!parsed.success) throw unauthenticated();
    await limit(`google:${phoneKey(request.ip)}`, 30, 900);
    let claim;
    try { claim = (await new OAuth2Client().verifyIdToken({ idToken: parsed.data.idToken, audience: env.GOOGLE_CLIENT_IDS.split(',').map((id) => id.trim()) })).getPayload(); }
    catch { throw unauthenticated(); }
    if (!claim?.sub || !claim.email || !claim.email_verified) throw unauthenticated();
    const subject = claim.sub, email = claim.email.toLowerCase();
    const identityId = await prisma.$transaction(async (tx) => {
      const linked = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'google', subject: subject } } });
      if (linked) return linked.identityId;
      const existing = await tx.identity.findUnique({ where: { email } });
      const authoritative = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com') || Boolean(claim.hd);
      if (existing && !authoritative) throw new AppError(409, 'LINK_REQUIRED', 'Sign in with email to this existing account. Google linking for this address is not available yet.');
      const identity = await tx.identity.upsert({ where: { email: email }, create: { email: email, emailVerifiedAt: new Date() }, update: { emailVerifiedAt: new Date() } });
      await tx.externalIdentity.create({ data: { provider: 'google', subject: subject, email, identityId: identity.id } });
      return identity.id;
    });
    return login(identityId, reply, request);
  });
}

import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db/client.js';
import { ensureRedisReady, redis } from '../infra/redis.js';
import { AppError } from '../http/errors.js';
import { env } from '../env.js';
import { emailSchema } from './email-login.js';
import { createOtpService, createTwilioProvider, otpService, phoneSchema } from './phone-otp.js';
import { accountDelivery, type AccountDelivery, type AccountChannel } from './account-delivery.js';
import { finishAccountSecurityChange, lockIdentitySecurity, lockIdentitySessionFamilies, lockRecentAccountSession, methodUnavailable, previousSecurityChannels, requireRecentAccountAuth, usableMethodCount } from './account-security.js';
import { newOpaqueToken, tokenDigest, validateAuthenticatedSession, type AuthenticatedSession } from './sessions.js';
const invalid = () => new AppError(400, 'INVALID_CONTACT_PROOF', 'Verification is invalid or expired. Start again.');
const lastMethod = () => new AppError(409, 'LAST_LOGIN_METHOD', 'Add and verify another sign-in method before removing this one.');
const contactOtp = createOtpService({ mode: env.SMS_DELIVERY_MODE, secret: env.SESSION_SECRET, namespace: 'visit:account-otp', ...(env.SMS_DELIVERY_MODE === 'twilio' ? { provider: createTwilioProvider({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, serviceSid: env.TWILIO_VERIFY_SERVICE_SID! }) } : {}) });
export function createAccountMethodsService({ delivery = accountDelivery, otp = contactOtp, loginOtp = otpService, namespace = 'visit:account', now = Date.now, secret = env.SESSION_SECRET, ready = ensureRedisReady }: { delivery?: AccountDelivery; otp?: typeof contactOtp; loginOtp?: typeof otpService; namespace?: string; now?: () => number; secret?: string; ready?: () => Promise<void> } = {}) {
  const digest = (id: string, code: string) => createHmac('sha256', secret).update(`contact:${id}:${code}`).digest('hex');
  async function limit(actor: AuthenticatedSession, ip: string, action: 'send' | 'verify') {
    try {
      await ready();
      for (const key of [actor.identity.id, `ip:${ip}`]) {
        const count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end return n", 1, `${namespace}:${action}:${tokenDigest(key)}`, action === 'send' ? 3600 : 900);
        if (Number(count) > (action === 'send' ? 10 : 30)) throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
      }
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'ACCOUNT_UNAVAILABLE', 'Account settings are temporarily unavailable.'); }
  }
  async function limitDestination(channel: AccountChannel, destination: string) {
    try {
      await ready();
      const key = `${namespace}:destination:${tokenDigest(`${channel}:${destination}`)}`;
      const allowed = await redis.eval("if redis.call('EXISTS',KEYS[1])==1 then return 0 end local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],3600) end if n>5 then return 0 end redis.call('SET',KEYS[1],'1','EX',30); return 1", 2, `${key}:cooldown`, `${key}:hour`);
      if (Number(allowed) !== 1) throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'ACCOUNT_UNAVAILABLE', 'Account settings are temporarily unavailable.'); }
  }
  async function readProof(handle: string, actor: AuthenticatedSession) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) throw invalid();
    const challenge = await prisma.accountContactChallenge.findUnique({ where: { handleHash: tokenDigest(handle) }, include: { identity: { select: { securityVersion: true } } } });
    if (!challenge || challenge.identityId !== actor.identity.id || challenge.sessionId !== actor.sessionId || challenge.securityVersion !== challenge.identity.securityVersion || challenge.consumedAt || !challenge.deliveredAt || challenge.expiresAt.getTime() <= now()) throw invalid();
    return challenge;
  }
  async function resourceLocks(tx: Parameters<typeof lockIdentitySecurity>[0], values: string[]) {
    for (const value of [...new Set(values)].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))::text`;
  }
  return {
    capabilities: { email: delivery.available('email'), phone: otp.mode !== 'disabled' },
    async list(actor: AuthenticatedSession) {
      await validateAuthenticatedSession(actor);
      const identity = await prisma.identity.findUniqueOrThrow({ where: { id: actor.identity.id }, include: { externalIdentities: { where: { provider: 'google' }, select: { id: true, email: true } } } });
      const count = Number(Boolean(identity.email && identity.emailVerifiedAt)) + Number(Boolean(identity.phone && identity.phoneVerifiedAt)) + identity.externalIdentities.length;
      const methods = [
        ...(identity.email ? [{ id: 'email', method: 'email', label: identity.email, verified: Boolean(identity.emailVerifiedAt), canRemove: count - Number(Boolean(identity.emailVerifiedAt)) > 0 }] : []),
        ...(identity.phone ? [{ id: 'phone', method: 'phone', label: identity.phone, verified: Boolean(identity.phoneVerifiedAt), canRemove: count - Number(Boolean(identity.phoneVerifiedAt)) > 0 }] : []),
        ...identity.externalIdentities.map(value => ({ id: value.id, method: 'google', label: value.email, verified: true, canRemove: count > 1 })),
      ];
      const events = await prisma.identitySecurityEvent.findMany({ where: { identityId: actor.identity.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, action: true, method: true, createdAt: true, notifications: { select: { channel: true, status: true, provider: true } } } });
      return { identityId: identity.id, methods, events, capabilities: { email: delivery.available('email'), phone: otp.mode !== 'disabled' }, reauthRequired: now() - actor.authenticatedAt.getTime() > 300000 || actor.authenticatedAt.getTime() > now() };
    },
    async start(input: { channel: AccountChannel; destination: string }, actor: AuthenticatedSession, ip: string) {
      await requireRecentAccountAuth(actor, new Date(now())); await limit(actor, ip, 'send');
      if (input.channel === 'phone' ? otp.mode === 'disabled' : !delivery.available('email')) throw new AppError(503, 'METHOD_NOT_CONFIGURED', 'This verification method is not configured.');
      const destination = input.channel === 'email' ? emailSchema.parse(input.destination) : phoneSchema.parse(input.destination);
      await limitDestination(input.channel, destination);
      const handle = newOpaqueToken(), id = randomUUID(), code = String(randomInt(0, 1000000)).padStart(6, '0');
      const challenge = await prisma.$transaction(async tx => {
        await lockIdentitySecurity(tx, actor.identity.id); await lockRecentAccountSession(tx, actor, new Date(now()));
        const identity = await tx.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
        await tx.accountContactChallenge.updateMany({ where: { identityId: identity.id, consumedAt: null }, data: { consumedAt: new Date(now()) } });
        return tx.accountContactChallenge.create({ data: { id, handleHash: tokenDigest(handle), identityId: identity.id, sessionId: actor.sessionId, securityVersion: identity.securityVersion, channel: input.channel, destination, codeHash: input.channel === 'email' ? digest(id, code) : null, expiresAt: new Date(now() + 600000) }, include: { identity: { select: { preferredLocale: true } } } });
      }, { maxWait: 5000, timeout: 5000 });
      try {
        let remaining = 600;
        if (input.channel === 'phone') remaining = (await otp.send(destination, ip)).expiresInSeconds;
        else await delivery.emailVerification({ destination, code, id, locale: challenge.identity.preferredLocale });
        const expiresAt = new Date(Math.min(challenge.expiresAt.getTime(), now() + remaining * 1000));
        const delivered = await prisma.accountContactChallenge.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date(now()) }, identity: { securityVersion: challenge.securityVersion }, session: { revokedAt: null, expiresAt: { gt: new Date(now()) } } }, data: { deliveredAt: new Date(now()), expiresAt } });
        if (delivered.count !== 1) throw invalid();
        return { accepted: true, challenge: handle, expiresInSeconds: Math.floor((expiresAt.getTime() - now()) / 1000), resendAfterSeconds: 30 };
      } catch (error) {
        await prisma.accountContactChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date(now()) } });
        throw error instanceof AppError ? error : new AppError(503, 'ACCOUNT_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable. Try again shortly.');
      }
    },
    async localCode(handle: string, actor: AuthenticatedSession) {
      await requireRecentAccountAuth(actor, new Date(now()));
      const proof = await readProof(handle, actor);
      const code = proof.channel === 'phone' ? await otp.localCode(proof.destination) : delivery.localCode?.(proof.id);
      if (!code) throw invalid(); return { code };
    },
    async verify(input: { challenge: string; code: string }, actor: AuthenticatedSession, ip: string) {
      await requireRecentAccountAuth(actor, new Date(now())); await limit(actor, ip, 'verify');
      if (!/^\d{6}$/.test(input.code)) throw invalid();
      const initial = await readProof(input.challenge, actor);
      // Commit attempt counters before checking an external provider or reporting an invalid code.
      const attempt = await prisma.$transaction(async tx => {
        await lockIdentitySecurity(tx, actor.identity.id); await lockRecentAccountSession(tx, actor, new Date(now()));
        const challenge = await tx.accountContactChallenge.findUniqueOrThrow({ where: { id: initial.id } });
        if (challenge.consumedAt || !challenge.deliveredAt || challenge.expiresAt.getTime() <= now() || challenge.attempts >= 5) return false;
        const identity = await tx.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
        if (identity.securityVersion !== challenge.securityVersion) return false;
        const valid = challenge.channel === 'phone' || Boolean(challenge.codeHash?.length === 64 && timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(digest(challenge.id, input.code))));
        await tx.accountContactChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 }, ...(!valid && challenge.attempts === 4 ? { consumedAt: new Date(now()) } : {}) } });
        return valid;
      }, { maxWait: 5000, timeout: 5000 });
      if (!attempt) throw invalid();
      let proofHash = tokenDigest(`account-email:${initial.id}`);
      if (initial.channel === 'phone') {
        try { proofHash = (await otp.verify(initial.destination, input.code, ip)).proofHash; }
        catch (error) { await prisma.accountContactChallenge.updateMany({ where: { id: initial.id, attempts: { gte: 5 }, consumedAt: null }, data: { consumedAt: new Date(now()) } }); throw error; }
      }
      const before = await prisma.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
      try {
        return await prisma.$transaction(async tx => {
          const old = initial.channel === 'email' ? before.email : before.phone;
          await resourceLocks(tx, [initial.destination, ...(old ? [old] : [])].map(value => `${initial.channel}:${value}`));
          await lockIdentitySecurity(tx, actor.identity.id);
          const session = await lockRecentAccountSession(tx, actor, new Date(now()));
          await lockIdentitySessionFamilies(tx, actor.identity.id);
          const identity = await tx.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
          if (identity.securityVersion !== initial.securityVersion || before.securityVersion !== identity.securityVersion) throw invalid();
          const challenge = await tx.accountContactChallenge.findUniqueOrThrow({ where: { id: initial.id } });
          if (challenge.consumedAt || challenge.expiresAt.getTime() <= now() || !challenge.deliveredAt) throw invalid();
          const owner = await tx.identity.findUnique({ where: initial.channel === 'email' ? { email: initial.destination } : { phone: initial.destination }, select: { id: true } });
          if (owner && owner.id !== identity.id) throw methodUnavailable();
          const alreadyVerified = initial.channel === 'email' ? identity.email === initial.destination && identity.emailVerifiedAt : identity.phone === initial.destination && identity.phoneVerifiedAt;
          if (alreadyVerified) throw methodUnavailable();
          const channels = await previousSecurityChannels(tx, identity);
          if (initial.channel === 'phone') for (const phone of [...new Set([initial.destination, ...(identity.phone ? [identity.phone] : [])])]) { await otp.invalidate(phone); await loginOtp.invalidate(phone); }
          await tx.accountContactChallenge.update({ where: { id: initial.id }, data: { consumedAt: new Date(now()) } });
          await tx.identity.update({ where: { id: identity.id }, data: initial.channel === 'email' ? { email: initial.destination, emailVerifiedAt: new Date(now()) } : { phone: initial.destination, phoneVerifiedAt: new Date(now()) } });
          if (initial.channel === 'email') await tx.emailChallenge.updateMany({ where: { email: initial.destination, consumedAt: null }, data: { consumedAt: new Date(now()) } });
          return finishAccountSecurityChange(tx, { identity, session, channels, notificationScope: namespace === 'visit:account' ? 'live' : namespace, action: old ? 'REPLACED' : 'LINKED', method: initial.channel as AccountChannel, rotate: true, proofHash }, new Date(now()));
        }, { maxWait: 5000, timeout: 5000 });
      } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw methodUnavailable(); throw error; }
    },
    async remove(input: { method: 'email' | 'phone' | 'google'; id?: string | undefined }, actor: AuthenticatedSession, ip?: string) {
      await requireRecentAccountAuth(actor, new Date(now())); await limit(actor, ip ?? actor.identity.id, 'verify');
      const before = await prisma.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
      const google = input.method === 'google' ? await prisma.externalIdentity.findFirst({ where: { id: input.id ?? '', identityId: actor.identity.id, provider: 'google' } }) : null;
      if (input.method === 'google' && !google) throw methodUnavailable();
      return prisma.$transaction(async tx => {
        const resource = input.method === 'google' ? google!.subject : input.method === 'email' ? before.email : before.phone;
        if (!resource) throw methodUnavailable();
        await resourceLocks(tx, [`${input.method}:${resource}`]); await lockIdentitySecurity(tx, actor.identity.id);
        const session = await lockRecentAccountSession(tx, actor, new Date(now()));
        await lockIdentitySessionFamilies(tx, actor.identity.id);
        const identity = await tx.identity.findUniqueOrThrow({ where: { id: actor.identity.id } });
        if (identity.securityVersion !== before.securityVersion) throw methodUnavailable();
        const usable = input.method === 'google' || Boolean(input.method === 'email' ? identity.emailVerifiedAt : identity.phoneVerifiedAt);
        if (await usableMethodCount(tx, identity) - Number(usable) < 1) throw lastMethod();
        const channels = await previousSecurityChannels(tx, identity);
        if (input.method === 'google') {
          const removed = await tx.externalIdentity.deleteMany({ where: { id: google!.id, identityId: identity.id, provider: 'google', subject: google!.subject } }); if (removed.count !== 1) throw methodUnavailable();
        } else if (input.method === 'email') await tx.identity.update({ where: { id: identity.id }, data: { email: null, emailVerifiedAt: null } });
        else { await otp.invalidate(identity.phone!); await loginOtp.invalidate(identity.phone!); await tx.identity.update({ where: { id: identity.id }, data: { phone: null, phoneVerifiedAt: null } }); }
        return finishAccountSecurityChange(tx, { identity, session, channels, notificationScope: namespace === 'visit:account' ? 'live' : namespace, action: 'REMOVED', method: input.method, rotate: true }, new Date(now()));
      }, { maxWait: 5000, timeout: 5000 });
    },
  };
}
export const accountMethodsService = createAccountMethodsService();

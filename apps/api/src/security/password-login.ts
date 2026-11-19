import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { lockIdentitySecurity } from './account-security.js';
import { AppError } from '../http/errors.js';
import { emailSchema } from './email-login.js';
import { env } from '../env.js';
import { accountDelivery, type AccountDelivery } from './account-delivery.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from './sessions.js';

// Email+password sign-in (decisions.md, 2026-11-01). Since login plan stage 2, slice 1, sign-up proves the
// address with a six-digit code before the account exists; accounts created earlier were trusted without
// proof and keep that address in `PasswordCredential.unprovenEmail`.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const displayNameSchema = z.string().trim().min(2).max(120);
// Every attempt counts against the IP. Only failed passwords count against an address, from one IP and
// overall, so a stranger cannot lock someone out by trying their email, and a correct password never adds up.
export const SIGN_IN_LIMITS = { ip: { maximum: 30, seconds: 900 }, addressFromIp: { maximum: 10, seconds: 900 }, address: { maximum: 100, seconds: 3600 } } as const;
export const SIGN_UP_LIMIT = { maximum: 10, seconds: 3600 } as const;
// Five guesses per code and five codes an hour would still let a stranger try ~25 codes an hour for a day
// on end, so wrong codes also count per address over a day (found by bf-security-reviewer).
export const SIGN_UP_CODE = { lifetimeSeconds: 600, attempts: 5, resendAfterSeconds: 30, sendsPerHour: 5, failuresPerDay: 15 } as const;
export const SIGN_UP_VERIFY_LIMIT = { maximum: 20, seconds: 900 } as const;
export const signUpLocaleSchema = z.enum(['he', 'en']).default('he');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: Buffer, options: ScryptOptions, keyLength: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password.normalize('NFKC'), salt, keyLength, { ...options, maxmem: 128 * options.N! * options.r! * 2 }, (error, key) => error ? reject(error) : resolve(key));
});
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
export const emailTaken = () => new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');
const signUpCodeInvalid = () => new AppError(400, 'SIGN_UP_CODE_INVALID', 'The code is incorrect.');
// Expired, used, superseded, tried too often or never issued: all look the same, and all mean "send a new code".
const signUpExpired = () => new AppError(410, 'SIGN_UP_EXPIRED', 'This code is no longer valid. Send a new code.');
const OPAQUE_HANDLE = /^[A-Za-z0-9_-]{43}$/;

export async function hashPassword(password: string) {
  const salt = randomBytes(SCRYPT.saltLength), key = await derive(password, salt, SCRYPT, SCRYPT.keyLength);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}
export async function passwordMatches(password: string, stored: string) {
  const [scheme, N, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) }, expected.length);
  return timingSafeEqual(actual, expected);
}

export function createPasswordLoginService({ namespace = 'visit:password', now = Date.now, ready = ensureRedisReady, delivery = accountDelivery, secret = env.SESSION_SECRET }: { namespace?: string; now?: () => number; ready?: () => Promise<void>; delivery?: AccountDelivery; secret?: string } = {}) {
  const codeDigest = (id: string, code: string) => createHmac('sha256', secret).update(`sign-up:${id}:${code}`).digest('hex');
  const emailLock = (tx: Prisma.TransactionClient, email: string) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${email}`}, 0))::text`;
  // Unknown addresses still pay for one hash comparison, so response time does not reveal which emails exist.
  let decoy: Promise<string> | undefined;
  async function guarded<T>(action: () => Promise<T>) {
    try { await ready(); return await action(); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-in is temporarily unavailable.'); }
  }
  const rateLimited = () => new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
  const count = (key: string, seconds: number) => redis.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, `${namespace}:limit:${key}`, seconds);
  const limit = (key: string, maximum: number, seconds: number) => guarded(async () => { if (Number(await count(key, seconds)) > maximum) throw rateLimited(); });
  const failureKeys = (email: string, ip: string) => [{ key: `sign-in:failed:${hash(email)}:${hash(ip)}`, ...SIGN_IN_LIMITS.addressFromIp }, { key: `sign-in:failed:${hash(email)}`, ...SIGN_IN_LIMITS.address }];
  const checkFailures = (email: string, ip: string) => guarded(async () => {
    const counts = await redis.mget(...failureKeys(email, ip).map(item => `${namespace}:limit:${item.key}`));
    if (failureKeys(email, ip).some((item, index) => Number(counts[index] ?? 0) >= item.maximum)) throw rateLimited();
  });
  const recordFailure = (email: string, ip: string) => guarded(async () => { for (const item of failureKeys(email, ip)) await count(item.key, item.seconds); });
  return {
    /**
     * Step 1 of sign-up: nothing is created but a pending row, and the answer is the same whether or not
     * the address is registered. A new address gets a code; a registered one gets "you already have an
     * account" and a row no code matches. Sending again for the same address supersedes the earlier row.
     */
    async startSignUp(input: { email: string; password: string; displayName: string; locale?: string | undefined }, ip: string) {
      const email = emailSchema.parse(input.email), password = passwordSchema.parse(input.password), displayName = displayNameSchema.parse(input.displayName), locale = signUpLocaleSchema.parse(input.locale);
      if (!delivery.available('email')) throw new AppError(503, 'METHOD_NOT_CONFIGURED', 'Email delivery is not configured.');
      await limit(`sign-up:ip:${hash(ip)}`, SIGN_UP_LIMIT.maximum, SIGN_UP_LIMIT.seconds);
      await guarded(async () => {
        const key = `${namespace}:limit:sign-up:address:${hash(email)}`;
        if (Number(await redis.get(`${key}:failed`) ?? 0) >= SIGN_UP_CODE.failuresPerDay) throw rateLimited();
        const allowed = await redis.eval("if redis.call('EXISTS',KEYS[1])==1 then return 0 end local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],ARGV[2]) end if n>tonumber(ARGV[3]) then return 0 end redis.call('SET',KEYS[1],'1','EX',ARGV[1]); return 1", 2, `${key}:cooldown`, `${key}:hour`, SIGN_UP_CODE.resendAfterSeconds, 3600, SIGN_UP_CODE.sendsPerHour);
        if (Number(allowed) !== 1) throw rateLimited();
      });
      // Hashed for a registered address too, so the answer takes as long either way.
      const passwordHash = await hashPassword(password), handle = newOpaqueToken(), id = randomUUID(), code = String(randomInt(0, 1000000)).padStart(6, '0');
      const expiresAt = new Date(now() + SIGN_UP_CODE.lifetimeSeconds * 1000);
      const pending = await prisma.$transaction(async tx => {
        await emailLock(tx, email);
        const registered = Boolean(await tx.identity.findUnique({ where: { email }, select: { id: true } }));
        await tx.pendingSignUp.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: new Date(now()) } });
        return tx.pendingSignUp.create({ data: { id, handleHash: tokenDigest(handle), email, displayName, locale, passwordHash: registered ? null : passwordHash, codeHash: registered ? null : codeDigest(id, code), expiresAt } });
      });
      try {
        await delivery.signUp({ destination: email, code: pending.codeHash ? code : null, id, locale });
        const delivered = await prisma.pendingSignUp.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date(now()) } }, data: { deliveredAt: new Date(now()) } });
        if (delivered.count !== 1) throw new Error('superseded while sending');
      } catch {
        await prisma.pendingSignUp.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date(now()) } });
        throw new AppError(503, 'ACCOUNT_DELIVERY_UNAVAILABLE', 'The code could not be sent. Try again shortly.');
      }
      return { accepted: true as const, signUp: handle, expiresInSeconds: SIGN_UP_CODE.lifetimeSeconds, resendAfterSeconds: SIGN_UP_CODE.resendAfterSeconds };
    },
    /** Step 2: the right code creates the account, its password and a session in one transaction. */
    async verifySignUp(input: { signUp: string; code: string }, ip: string) {
      await limit(`sign-up:verify:${hash(ip)}`, SIGN_UP_VERIFY_LIMIT.maximum, SIGN_UP_VERIFY_LIMIT.seconds);
      if (!OPAQUE_HANDLE.test(input.signUp)) throw signUpExpired();
      if (!/^[0-9]{6}$/.test(input.code)) throw signUpCodeInvalid();
      const handleHash = tokenDigest(input.signUp);
      const found = await prisma.pendingSignUp.findUnique({ where: { handleHash }, select: { email: true } });
      if (!found) throw signUpExpired();
      // The daily count also stops guesses on a code already sent before it was reached.
      if (Number(await guarded(() => redis.get(`${namespace}:limit:sign-up:address:${hash(found.email)}:failed`)) ?? 0) >= SIGN_UP_CODE.failuresPerDay) throw signUpExpired();
      const rawSessionToken = newOpaqueToken();
      // A wrong code returns instead of throwing, so its attempt is committed before the answer.
      const outcome = await prisma.$transaction(async tx => {
        // The same lock order as step 1 (address, then row), so a resend and a verify cannot deadlock.
        await emailLock(tx, found.email);
        await tx.$queryRaw`SELECT id FROM "PendingSignUp" WHERE "handleHash" = ${handleHash} FOR UPDATE`;
        const current = new Date(now());
        const pending = await tx.pendingSignUp.findUniqueOrThrow({ where: { handleHash } });
        if (pending.consumedAt || !pending.deliveredAt || pending.expiresAt <= current || pending.attempts >= SIGN_UP_CODE.attempts) return 'expired' as const;
        const expected = pending.codeHash ? Buffer.from(pending.codeHash, 'hex') : undefined, actual = Buffer.from(codeDigest(pending.id, input.code), 'hex');
        if (!expected || !pending.passwordHash || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          const last = pending.attempts + 1 >= SIGN_UP_CODE.attempts;
          await tx.pendingSignUp.update({ where: { id: pending.id }, data: { attempts: { increment: 1 }, ...(last ? { consumedAt: current } : {}) } });
          return last ? 'exhausted' as const : 'invalid' as const;
        }
        await tx.pendingSignUp.update({ where: { id: pending.id }, data: { attempts: { increment: 1 }, consumedAt: current } });
        // Registered meanwhile (by email link or Google): the code proved the address, so saying so reveals nothing.
        if (await tx.identity.findUnique({ where: { email: pending.email }, select: { id: true } })) return 'taken' as const;
        const person = await tx.identity.create({ data: { email: pending.email, emailVerifiedAt: current, displayName: pending.displayName } });
        await lockIdentitySecurity(tx, person.id);
        await tx.passwordCredential.create({ data: { identityId: person.id, hash: pending.passwordHash } });
        await tx.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(rawSessionToken), expiresAt: sessionExpiry(current), authenticationProofHash: hash(`sign-up:${pending.id}`) } });
        return { id: person.id, email: person.email, platformRole: person.platformRole };
      }).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return 'taken' as const;
        throw error;
      });
      if (outcome === 'invalid' || outcome === 'exhausted') await guarded(async () => { await count(`sign-up:address:${hash(found.email)}:failed`, 86400); });
      if (outcome === 'expired' || outcome === 'exhausted') throw signUpExpired();
      if (outcome === 'invalid') throw signUpCodeInvalid();
      if (outcome === 'taken') throw emailTaken();
      return { token: rawSessionToken, identity: outcome };
    },
    /** Development only: what a local-inbox sign-up "sent", found by the handle its client holds. */
    async localSignUpCode(handle: string) {
      const pending = OPAQUE_HANDLE.test(handle) ? await prisma.pendingSignUp.findUnique({ where: { handleHash: tokenDigest(handle) }, select: { id: true, consumedAt: true, expiresAt: true } }) : null;
      const message = pending && !pending.consumedAt && pending.expiresAt.getTime() > now() ? delivery.localSignUp?.(pending.id) : undefined;
      if (!message) throw new AppError(404, 'NOT_FOUND', 'No unexpired sign-up code is available.');
      return { code: message.code, existingAccount: message.code === null };
    },
    async signIn(input: { email: string; password: string }, ip: string) {
      const parsedEmail = emailSchema.safeParse(input.email), parsedPassword = passwordSchema.safeParse(input.password);
      await limit(`sign-in:ip:${hash(ip)}`, SIGN_IN_LIMITS.ip.maximum, SIGN_IN_LIMITS.ip.seconds);
      if (!parsedEmail.success || !parsedPassword.success) throw invalidCredentials();
      const email = parsedEmail.data;
      await checkFailures(email, ip);
      const person = await prisma.identity.findUnique({ where: { email }, select: { id: true, passwordCredential: { select: { hash: true } } } });
      const stored = person?.passwordCredential?.hash;
      const decoyHash = () => decoy ??= hashPassword(newOpaqueToken()).catch((error: unknown) => { decoy = undefined; throw error; });
      if (!stored || !person) { await passwordMatches(parsedPassword.data, await decoyHash()); await recordFailure(email, ip); throw invalidCredentials(); }
      if (!await passwordMatches(parsedPassword.data, stored)) { await recordFailure(email, ip); throw invalidCredentials(); }
      const rawSessionToken = newOpaqueToken(), current = new Date(now());
      const identity = await prisma.$transaction(async tx => {
        await lockIdentitySecurity(tx, person.id);
        // The address or password may have changed while the hash was compared; only the checked pair signs in.
        const locked = await tx.identity.findUnique({ where: { id: person.id }, select: { id: true, email: true, platformRole: true, passwordCredential: { select: { hash: true } } } });
        if (!locked || locked.email !== email || locked.passwordCredential?.hash !== stored) throw invalidCredentials();
        await tx.session.create({ data: { identityId: locked.id, tokenHash: tokenDigest(rawSessionToken), expiresAt: sessionExpiry(current) } });
        return { id: locked.id, email: locked.email, platformRole: locked.platformRole };
      });
      return { token: rawSessionToken, identity };
    },
  };
}

export const passwordLoginService = createPasswordLoginService();

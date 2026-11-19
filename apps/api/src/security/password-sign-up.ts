import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { AppError } from '../http/errors.js';
import { env } from '../env.js';
import { lockIdentitySecurity } from './account-security.js';
import { emailSchema } from './email-login.js';
import { displayNameSchema, hashPassword, passwordSchema, SIGN_UP_LIMIT } from './password-login.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from './sessions.js';
import { signUpDelivery, type SignUpDelivery, type SignUpLocale } from './sign-up-delivery.js';

// Password sign-up proves the email before the account exists (login-plan-stage-2.md, slice 1; decisions.md,
// "Verified password sign-up"). Every request for a valid form answers the same: a registered address gets
// "you already have an account" in place of a code, under the same limits, and its pending row never verifies.
export const SIGN_UP_CODE_SECONDS = 600;
export const SIGN_UP_CODE_ATTEMPTS = 5;
export const SIGN_UP_RESEND_SECONDS = 30;
export const SIGN_UP_ADDRESS_LIMIT = { maximum: 5, seconds: 3600 } as const;
export const SIGN_UP_VERIFY_LIMIT = { maximum: 20, seconds: 900 } as const;
export const signUpLocaleSchema = z.enum(['he', 'en']).default('he');
export const PENDING_SIGN_UP_HANDLE = /^[A-Za-z0-9_-]{43}$/;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const newCode = () => String(randomInt(0, 1000000)).padStart(6, '0');
const notConfigured = () => new AppError(503, 'METHOD_NOT_CONFIGURED', 'Email sign-up is not configured.');
const unavailable = () => new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-up is temporarily unavailable.');
const rateLimited = () => new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
const deliveryFailed = () => new AppError(503, 'EMAIL_DELIVERY_FAILED', 'The email could not be sent. Please retry shortly.');
// An unknown, reused, superseded or expired pending sign-up, and a code for another one, are all refused alike.
export const signUpExpired = () => new AppError(400, 'SIGN_UP_EXPIRED', 'This sign-up has expired. Start again.');
const wrongCode = () => new AppError(400, 'SIGN_UP_CODE_INVALID', 'The code is incorrect. Check it and try again.');
const tooManyAttempts = () => new AppError(400, 'SIGN_UP_TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Start again.');
// Only after a correct code, so it tells nothing to someone who does not hold the address.
const accountExists = () => new AppError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Sign in instead.');

type Transaction = Parameters<typeof lockIdentitySecurity>[0];
const lockEmail = (tx: Transaction, email: string) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${email}`}, 0))::text`;
const ownerLocale = (stored: string | null, fallback: SignUpLocale): SignUpLocale => stored === 'en' || stored === 'he' ? stored : fallback;

export function createPasswordSignUpService({ delivery = signUpDelivery, namespace = 'visit:password', secret = env.SESSION_SECRET, now = Date.now, ready = ensureRedisReady }: { delivery?: SignUpDelivery; namespace?: string; secret?: string; now?: () => number; ready?: () => Promise<void> } = {}) {
  const digest = (id: string, code: string) => createHmac('sha256', secret).update(`sign-up:${id}:${code}`).digest('hex');
  async function guarded<T>(action: () => Promise<T>) {
    try { await ready(); return await action(); }
    catch (error) { if (error instanceof AppError) throw error; throw unavailable(); }
  }
  const limit = (key: string, maximum: number, seconds: number) => guarded(async () => {
    const count = await redis.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, `${namespace}:limit:${key}`, seconds);
    if (Number(count) > maximum) throw rateLimited();
  });
  // Per address, whoever asks: a cooldown between sends and a cap per hour, for codes and "you already have an account" alike.
  const limitAddress = (email: string) => guarded(async () => {
    const key = `${namespace}:sign-up:address:${hash(email)}`;
    const allowed = await redis.eval("if redis.call('EXISTS',KEYS[1])==1 then return 0 end local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],ARGV[2]) end if n>tonumber(ARGV[3]) then return 0 end redis.call('SET',KEYS[1],'1','EX',ARGV[1]); return 1", 2, `${key}:cooldown`, `${key}:hour`, SIGN_UP_RESEND_SECONDS, SIGN_UP_ADDRESS_LIMIT.seconds, SIGN_UP_ADDRESS_LIMIT.maximum);
    if (Number(allowed) !== 1) throw rateLimited();
  });
  const answer = (handle: string, expiresAt: Date) => ({ accepted: true, pendingId: handle, expiresInSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now()) / 1000)), resendAfterSeconds: SIGN_UP_RESEND_SECONDS });
  // Delivery happens outside the transaction; only a delivered row can be verified, and a failed send leaves nothing usable.
  async function deliver(row: { id: string; email: string; locale: string; existingAccount: boolean; codeHash: string | null }, code: string) {
    try {
      await delivery.send({ id: row.id, sendId: randomUUID(), destination: row.email, locale: ownerLocale(row.locale, 'he'), message: row.existingAccount ? { kind: 'existing-account' } : { kind: 'code', code } });
      const delivered = await prisma.pendingSignUp.updateMany({ where: { id: row.id, consumedAt: null, codeHash: row.codeHash, expiresAt: { gt: new Date(now()) } }, data: { deliveredAt: new Date(now()) } });
      if (delivered.count !== 1) throw deliveryFailed();
    } catch (error) {
      await prisma.pendingSignUp.updateMany({ where: { id: row.id, consumedAt: null, codeHash: row.codeHash }, data: { consumedAt: new Date(now()), passwordHash: null, codeHash: null } });
      throw error instanceof AppError ? error : deliveryFailed();
    }
  }
  return {
    delivery,
    async signUp(input: { email: string; password: string; displayName: string; locale?: string | undefined }, ip: string) {
      const email = emailSchema.parse(input.email), password = passwordSchema.parse(input.password), displayName = displayNameSchema.parse(input.displayName), locale = signUpLocaleSchema.parse(input.locale);
      if (!delivery.available()) throw notConfigured();
      await limit(`sign-up:ip:${hash(ip)}`, SIGN_UP_LIMIT.maximum, SIGN_UP_LIMIT.seconds);
      await limitAddress(email);
      // Hashed for a registered address too, so the time taken does not tell the two apart.
      const passwordHash = await hashPassword(password), handle = newOpaqueToken(), id = randomUUID(), code = newCode(), current = new Date(now());
      const row = await prisma.$transaction(async tx => {
        await lockEmail(tx, email);
        const owner = await tx.identity.findUnique({ where: { email }, select: { preferredLocale: true } });
        // A new sign-up for the address supersedes any earlier one, whoever started it.
        await tx.pendingSignUp.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: current, passwordHash: null, codeHash: null } });
        return tx.pendingSignUp.create({ data: {
          id, handleHash: tokenDigest(handle), email, displayName, expiresAt: new Date(current.getTime() + SIGN_UP_CODE_SECONDS * 1000),
          ...(owner ? { existingAccount: true, locale: ownerLocale(owner.preferredLocale, locale) } : { passwordHash, codeHash: digest(id, code), locale }),
        } });
      });
      await deliver(row, code);
      return answer(handle, row.expiresAt);
    },
    async resend(handle: string, ip: string) {
      if (!PENDING_SIGN_UP_HANDLE.test(handle)) throw signUpExpired();
      if (!delivery.available()) throw notConfigured();
      await limit(`sign-up:ip:${hash(ip)}`, SIGN_UP_LIMIT.maximum, SIGN_UP_LIMIT.seconds);
      const found = await prisma.pendingSignUp.findUnique({ where: { handleHash: tokenDigest(handle) } });
      if (!found || found.consumedAt || found.expiresAt.getTime() <= now()) throw signUpExpired();
      await limitAddress(found.email);
      const code = newCode(), current = new Date(now());
      // A new code replaces the old one on the same row, with fresh attempts and a fresh ten minutes.
      const row = await prisma.$transaction(async tx => {
        await lockEmail(tx, found.email);
        const updated = await tx.pendingSignUp.updateMany({ where: { id: found.id, consumedAt: null, expiresAt: { gt: current } }, data: { codeHash: found.existingAccount ? null : digest(found.id, code), attempts: 0, deliveredAt: null, expiresAt: new Date(current.getTime() + SIGN_UP_CODE_SECONDS * 1000) } });
        if (updated.count !== 1) throw signUpExpired();
        return tx.pendingSignUp.findUniqueOrThrow({ where: { id: found.id } });
      });
      await deliver(row, code);
      return answer(handle, row.expiresAt);
    },
    async verify(input: { pendingId: string; code: string }, ip: string) {
      await limit(`sign-up:verify:${hash(ip)}`, SIGN_UP_VERIFY_LIMIT.maximum, SIGN_UP_VERIFY_LIMIT.seconds);
      if (!PENDING_SIGN_UP_HANDLE.test(input.pendingId)) throw signUpExpired();
      if (!/^\d{6}$/.test(input.code)) throw wrongCode();
      const found = await prisma.pendingSignUp.findUnique({ where: { handleHash: tokenDigest(input.pendingId) }, select: { id: true, email: true } });
      if (!found) throw signUpExpired();
      const rawSessionToken = newOpaqueToken(), current = new Date(now());
      // Attempts commit before the answer, so a wrong code always counts.
      const outcome = await prisma.$transaction(async tx => {
        await lockEmail(tx, found.email);
        const row = await tx.pendingSignUp.findUniqueOrThrow({ where: { id: found.id } });
        if (row.consumedAt || !row.deliveredAt || row.expiresAt <= current || row.attempts >= SIGN_UP_CODE_ATTEMPTS) return { kind: 'expired' } as const;
        const expected = digest(row.id, input.code);
        const valid = !row.existingAccount && Boolean(row.passwordHash) && row.codeHash?.length === expected.length && timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(expected));
        if (!valid) {
          const last = row.attempts + 1 >= SIGN_UP_CODE_ATTEMPTS;
          await tx.pendingSignUp.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, ...(last ? { consumedAt: current, passwordHash: null, codeHash: null } : {}) } });
          return { kind: last ? 'exhausted' : 'wrong' } as const;
        }
        await tx.pendingSignUp.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, consumedAt: current, passwordHash: null, codeHash: null } });
        if (await tx.identity.findUnique({ where: { email: row.email }, select: { id: true } })) return { kind: 'taken' } as const;
        // A released contact never brings back authority: public sign-up always creates USER.
        const person = await tx.identity.create({ data: { email: row.email, emailVerifiedAt: current, displayName: row.displayName, preferredLocale: row.locale } });
        await lockIdentitySecurity(tx, person.id);
        await tx.passwordCredential.create({ data: { identityId: person.id, hash: row.passwordHash! } });
        await tx.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(rawSessionToken), expiresAt: sessionExpiry(current) } });
        return { kind: 'created', identity: { id: person.id, email: person.email, platformRole: person.platformRole } } as const;
      }).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return { kind: 'taken' } as const;
        throw error;
      });
      if (outcome.kind === 'expired') throw signUpExpired();
      if (outcome.kind === 'wrong') throw wrongCode();
      if (outcome.kind === 'exhausted') throw tooManyAttempts();
      if (outcome.kind === 'taken') throw accountExists();
      return { token: rawSessionToken, identity: outcome.identity };
    },
    /** Local inbox only (the loopback development helper and tests): what the last email for this sign-up said. */
    async localMessage(handle: string) {
      if (!delivery.local || !PENDING_SIGN_UP_HANDLE.test(handle)) throw signUpExpired();
      const row = await prisma.pendingSignUp.findUnique({ where: { handleHash: tokenDigest(handle) }, select: { id: true, consumedAt: true, deliveredAt: true, expiresAt: true } });
      const message = row && !row.consumedAt && row.deliveredAt && row.expiresAt.getTime() > now() ? delivery.localMessage?.(row.id) : undefined;
      if (!message) throw signUpExpired();
      return message.kind === 'code' ? { code: message.code } : { existingAccount: true };
    },
  };
}

export const passwordSignUpService = createPasswordSignUpService();

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { lockIdentitySecurity } from './account-security.js';
import { AppError } from '../http/errors.js';
import { emailSchema } from './email-login.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from './sessions.js';

// MVP email+password sign-in (decisions.md, 2026-11-01). The address is trusted without proof and
// marked verified at sign-up; the credential keeps that address so these accounts can be re-verified.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const displayNameSchema = z.string().trim().min(2).max(120);
// Every attempt counts against the IP. Only failed passwords count against an address, from one IP and
// overall, so a stranger cannot lock someone out by trying their email, and a correct password never adds up.
export const SIGN_IN_LIMITS = { ip: { maximum: 30, seconds: 900 }, addressFromIp: { maximum: 10, seconds: 900 }, address: { maximum: 100, seconds: 3600 } } as const;
export const SIGN_UP_LIMIT = { maximum: 10, seconds: 3600 } as const;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: Buffer, options: ScryptOptions, keyLength: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password.normalize('NFKC'), salt, keyLength, { ...options, maxmem: 128 * options.N! * options.r! * 2 }, (error, key) => error ? reject(error) : resolve(key));
});
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
export const emailTaken = () => new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');

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

export function createPasswordLoginService({ namespace = 'visit:password', now = Date.now, ready = ensureRedisReady }: { namespace?: string; now?: () => number; ready?: () => Promise<void> } = {}) {
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
    async signUp(input: { email: string; password: string; displayName: string }, ip: string) {
      const email = emailSchema.parse(input.email), password = passwordSchema.parse(input.password), displayName = displayNameSchema.parse(input.displayName);
      await limit(`sign-up:ip:${hash(ip)}`, SIGN_UP_LIMIT.maximum, SIGN_UP_LIMIT.seconds);
      const passwordHash = await hashPassword(password), rawSessionToken = newOpaqueToken(), current = new Date(now());
      const identity = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${email}`}, 0))::text`;
        // An existing account is never modified or entered from sign-up, whichever method created it.
        if (await tx.identity.findUnique({ where: { email }, select: { id: true } })) throw emailTaken();
        const person = await tx.identity.create({ data: { email, emailVerifiedAt: current, displayName } });
        await lockIdentitySecurity(tx, person.id);
        await tx.passwordCredential.create({ data: { identityId: person.id, hash: passwordHash, unprovenEmail: email } });
        await tx.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(rawSessionToken), expiresAt: sessionExpiry(current) } });
        return { id: person.id, email: person.email, platformRole: person.platformRole };
      }).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw emailTaken();
        throw error;
      });
      return { token: rawSessionToken, identity };
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

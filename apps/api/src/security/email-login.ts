import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { lockIdentitySecurity } from './account-security.js';
import { AppError, unauthenticated } from '../http/errors.js';
import { env } from '../env.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from './sessions.js';

export const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const lifetime = 15 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type EmailMessage = { email: string; token: string; link: string; expiresAt: number; id: string };
export type EmailDelivery = { mode: 'local-inbox' | 'resend'; send: (message: EmailMessage) => Promise<void>; take?: (email: string) => EmailMessage | undefined };
const failedDelivery = () => new AppError(503, 'EMAIL_DELIVERY_FAILED', 'Sign-in email could not be sent. Please retry shortly.');
export function emailLoginLink(token: string, target: 'web' | 'native', webOrigin: string) {
  const url = target === 'native' ? new URL('visit://auth/email') : new URL('/auth/email', webOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}
export function createLocalEmailDelivery(): EmailDelivery {
  const mailbox = new Map<string, EmailMessage>();
  return {
    mode: 'local-inbox',
    async send(message) {
      for (const [email, item] of mailbox) if (item.expiresAt <= Date.now()) mailbox.delete(email);
      if (mailbox.size >= 1000) mailbox.delete(mailbox.keys().next().value!);
      if ((mailbox.get(message.email)?.expiresAt ?? 0) > message.expiresAt) return;
      mailbox.set(message.email, message);
    },
    take(email) { const result = mailbox.get(email); mailbox.delete(email); return result; },
  };
}
export function createResendEmailDelivery({ apiKey, from, transport = fetch }: { apiKey: string; from: string; transport?: typeof fetch }): EmailDelivery {
  return { mode: 'resend', async send(message) {
    try {
      const escaped = message.link.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const response = await transport('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `email-login/${message.id}` }, body: JSON.stringify({ from, to: [message.email], subject: 'Your Visit sign-in link', text: `Sign in to Visit: ${message.link}\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`, html: `<p>Sign in to Visit</p><p><a href="${escaped}">Continue to Visit</a></p><p>This link expires in 15 minutes and can be used once. If you did not request it, ignore this email.</p>` }), signal: AbortSignal.timeout(10000) });
      if (!response.ok || typeof (await response.json() as { id?: unknown }).id !== 'string') throw failedDelivery();
    } catch { throw failedDelivery(); }
  } };
}

export function createEmailLoginService({ delivery, webOrigin = env.WEB_APP_URL, namespace = 'visit:email', now = Date.now, ready = ensureRedisReady }: { delivery: EmailDelivery; webOrigin?: string; namespace?: string; now?: () => number; ready?: () => Promise<void> }) {
  async function limit(key: string, maximum: number, seconds: number) {
    try {
      await ready();
      const count = await redis.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, `${namespace}:limit:${key}`, seconds);
      if (Number(count) > maximum) throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-in is temporarily unavailable.'); }
  }
  return {
    deliveryMode: delivery.mode,
    async send(emailInput: string, ip: string, target: 'web' | 'native' = 'web') {
      const email = emailSchema.parse(emailInput);
      if (!['web', 'native'].includes(target)) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a supported sign-in destination.');
      await Promise.all([limit(`ip:${hash(ip)}`, 10, 3600), limit(`address:${hash(email)}`, 5, 3600)]);
      try { if (await redis.set(`${namespace}:cooldown:${hash(email)}`, '1', 'EX', 30, 'NX') !== 'OK') throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.'); }
      catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-in is temporarily unavailable.'); }
      const token = newOpaqueToken(), expiresAt = new Date(now() + lifetime);
      const challenge = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${email}`}, 0))::text`;
        const identity = await tx.identity.findUnique({ where: { email }, select: { id: true } });
        await tx.emailChallenge.updateMany({ where: { email, purpose: 'EMAIL_LOGIN', consumedAt: null }, data: { consumedAt: new Date(now()) } });
        return tx.emailChallenge.create({ data: { email, identityId: identity?.id ?? null, tokenHash: tokenDigest(token), expiresAt } });
      });
      try {
        await delivery.send({ email, token, expiresAt: expiresAt.getTime(), id: challenge.id, link: emailLoginLink(token, target, webOrigin) });
        const delivered = await prisma.emailChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date(now()) } }, data: { deliveredAt: new Date(now()) } });
        if (delivered.count !== 1) throw failedDelivery();
      } catch {
        await prisma.emailChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date(now()) } });
        throw failedDelivery();
      }
      return { accepted: true, message: 'If this address can sign in, a link will arrive shortly.', expiresInSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now()) / 1000)), resendAfterSeconds: 30 };
    },
    async localMessage(emailInput: string) {
      const email = emailSchema.parse(emailInput), message = delivery.take?.(email);
      if (!message || message.expiresAt <= now()) throw new AppError(404, 'NOT_FOUND', 'No unexpired sign-in email is available.');
      if (!await prisma.emailChallenge.findFirst({ where: { id: message.id, tokenHash: tokenDigest(message.token), consumedAt: null, deliveredAt: { not: null }, expiresAt: { gt: new Date(now()) } }, select: { id: true } })) throw new AppError(404, 'NOT_FOUND', 'No unexpired sign-in email is available.');
      return { token: message.token, link: message.link, expiresAt: new Date(message.expiresAt).toISOString() };
    },
    async verify(token: string, ip: string) {
      await limit(`verify:${hash(ip)}`, 20, 900);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthenticated();
      const rawSessionToken = newOpaqueToken(), current = new Date(now());
      const identity = await prisma.$transaction(async tx => {
        const challenge = await tx.emailChallenge.findUnique({ where: { tokenHash: tokenDigest(token) } });
        if (!challenge || challenge.purpose !== 'EMAIL_LOGIN' || challenge.consumedAt || !challenge.deliveredAt || challenge.expiresAt <= current) throw unauthenticated();
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${challenge.email}`}, 0))::text`;
        if (challenge.identityId) await lockIdentitySecurity(tx, challenge.identityId);
        const consumed = await tx.emailChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, deliveredAt: { not: null }, expiresAt: { gt: current } }, data: { consumedAt: current } });
        if (consumed.count !== 1) throw unauthenticated();
        let person;
        if (challenge.identityId) {
          const verified = await tx.identity.updateMany({ where: { id: challenge.identityId, email: challenge.email }, data: { emailVerifiedAt: current } });
          if (verified.count !== 1) throw unauthenticated();
          person = await tx.identity.findUniqueOrThrow({ where: { id: challenge.identityId } });
        } else {
          if (await tx.identity.findUnique({ where: { email: challenge.email }, select: { id: true } })) throw unauthenticated();
          // A released contact must never transfer administrative authority to a new identity.
          // Bootstrap/admin promotion is an explicit operator workflow, never public sign-up.
          person = await tx.identity.create({ data: { email: challenge.email, emailVerifiedAt: current } });
        }
        if (!challenge.identityId) await lockIdentitySecurity(tx, person.id);
        await tx.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(rawSessionToken), expiresAt: sessionExpiry(current), authenticationProofHash: hash(`email:${challenge.id}`) } });
        return { id: person.id, email: person.email, platformRole: person.platformRole };
      }).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw unauthenticated();
        throw error;
      });
      return { token: rawSessionToken, identity };
    },
  };
}
export const emailLoginService = createEmailLoginService({ delivery: env.EMAIL_DELIVERY_MODE === 'local-inbox' ? createLocalEmailDelivery() : createResendEmailDelivery({ apiKey: env.EMAIL_API_KEY!, from: env.EMAIL_FROM }) });

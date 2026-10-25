import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis, ensureRedisReady } from '../src/infra/redis.js';
import { env } from '../src/env.js';
import { AppError } from '../src/http/errors.js';
import { createAccountMethodsService } from '../src/security/account-methods.js';
import { createLocalAccountDelivery, createAccountDelivery } from '../src/security/account-delivery.js';
import { createEmailLoginService, createLocalEmailDelivery } from '../src/security/email-login.js';
import { createOtpService } from '../src/security/phone-otp.js';
import { authenticate, tokenDigest, newOpaqueToken, rotateSession, revokeSessionFamily } from '../src/security/sessions.js';
import { createSecurityNotificationWorker } from '../src/security/security-notifications.js';
import { registerAccountMethods } from '../src/routes/account-methods.js';
import { registerRequestSecurity } from '../src/security/request-security.js';

const denied = (status: number, code?: string) => (error: unknown) => error instanceof AppError && error.statusCode === status && (!code || error.code === code);
test('account methods bind ownership, recent authentication, proof, contact namespace and session recovery', async t => {
  await ensureRedisReady();
  const run = randomUUID(), namespace = `test:account:${run}`, ids: string[] = [], origin = 'https://app.example.test';
  const delivery = createLocalAccountDelivery();
  const otp = createOtpService({ mode: 'local-inbox', namespace: `${namespace}:otp`, secret: 'test-only-contact-secret' });
  const loginOtp = createOtpService({ mode: 'local-inbox', namespace: `${namespace}:login`, secret: 'test-only-login-secret' });
  const account = createAccountMethodsService({ delivery, otp, loginOtp, namespace, secret: 'test-only-email-secret' });
  const app = Fastify(); registerRequestSecurity(app, origin); await registerAccountMethods(app, { account });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'VALIDATION_ERROR' } }));
  async function actor(options: { email?: boolean; phone?: boolean; google?: boolean } = { email: true }) {
    const identity = await prisma.identity.create({ data: { ...(options.email ? { email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date() } : {}), ...(options.phone ? { phone: `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`, phoneVerifiedAt: new Date() } : {}) } }); ids.push(identity.id);
    if (options.google) await prisma.externalIdentity.create({ data: { identityId: identity.id, provider: 'google', subject: randomUUID(), email: `${randomUUID()}@example.test` } });
    const raw = newOpaqueToken(); const session = await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(raw), expiresAt: new Date(Date.now() + 3600000) } });
    const context = await authenticate({ headers: { authorization: `Bearer ${raw}` } } as FastifyRequest);
    return { identity, raw, session, context };
  }
  async function nextContext(raw: string) { return authenticate({ headers: { authorization: `Bearer ${raw}` } } as FastifyRequest); }
  async function emailProof(person: Awaited<ReturnType<typeof actor>>, email = `${randomUUID()}@example.test`) {
    const start = await account.start({ channel: 'email', destination: email }, person.context, randomUUID());
    const { code } = await account.localCode(start.challenge, person.context); return { start, code, email };
  }
  try {
    await t.test('lists own methods only and rejects forged/stale/revoked sessions, CSRF and missing consent', async () => {
      const a = await actor({ email: true, google: true }), b = await actor();
      const own = await account.list(a.context); assert.equal(own.methods.length, 2); assert.ok(own.methods.every(method => method.label !== b.identity.email));
      await assert.rejects(account.list({ ...a.context }), denied(401));
      await assert.rejects(account.start({ channel: 'email', destination: 'test@example.test' }, { ...a.context }, randomUUID()), denied(401));
      for (const body of [{ method: 'email' }, { method: 'google', id: (await account.list(b.context)).methods[0]!.id, consent: true }, { method: 'email', id: 'foreign', consent: true }]) {
        const response = await app.inject({ method: 'POST', url: '/api/account/sign-in-methods/remove', headers: { authorization: `Bearer ${a.raw}`, origin }, payload: body });
        assert.ok([400, 409].includes(response.statusCode));
      }
      assert.equal((await app.inject({ method: 'POST', url: '/api/account/contact-challenges', headers: { authorization: `Bearer ${a.raw}`, origin: 'https://evil.example.test' }, payload: { channel: 'email', destination: 'test@example.test', consent: true } })).statusCode, 403);
      await prisma.session.update({ where: { id: a.session.id }, data: { authenticatedAt: new Date(Date.now() - 360000) } });
      const stale = await nextContext(a.raw); await assert.rejects(account.remove({ method: 'email' }, stale), denied(401, 'REAUTH_REQUIRED'));
      await prisma.session.update({ where: { id: a.session.id }, data: { revokedAt: new Date() } }); await assert.rejects(account.list(a.context), denied(401));
    });
    await t.test('email proof is exact-session bound, expiring, attempts bounded, superseded and never a login proof', async () => {
      const a = await actor(), b = await actor();
      const proof = await emailProof(a);
      await assert.rejects(account.verify({ challenge: proof.start.challenge, code: proof.code }, b.context, randomUUID()), denied(400, 'INVALID_CONTACT_PROOF'));
      const secondRaw = newOpaqueToken(); await prisma.session.create({ data: { identityId: a.identity.id, tokenHash: tokenDigest(secondRaw), expiresAt: new Date(Date.now() + 600000) } });
      await assert.rejects(account.verify({ challenge: proof.start.challenge, code: proof.code }, await nextContext(secondRaw), randomUUID()), denied(400));
      await prisma.accountContactChallenge.update({ where: { handleHash: tokenDigest(proof.start.challenge) }, data: { expiresAt: new Date(Date.now() - 1) } });
      await assert.rejects(account.verify({ challenge: proof.start.challenge, code: proof.code }, a.context, randomUUID()), denied(400));
      const bounded = await emailProof(a);
      const wrong = bounded.code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await assert.rejects(account.verify({ challenge: bounded.start.challenge, code: wrong }, a.context, randomUUID()), denied(400));
      assert.equal((await prisma.accountContactChallenge.findUniqueOrThrow({ where: { handleHash: tokenDigest(bounded.start.challenge) } })).attempts, 5);
      await assert.rejects(account.verify({ challenge: bounded.start.challenge, code: bounded.code }, a.context, randomUUID()), denied(400));
      const old = await emailProof(a), latest = await emailProof(a);
      await assert.rejects(account.verify({ challenge: old.start.challenge, code: old.code }, a.context, randomUUID()), denied(400));
      assert.equal(await prisma.session.count({ where: { identityId: a.identity.id } }), 2); assert.ok(latest.code);
    });
    await t.test('successful replacement rotates current device into new family, revokes all old sessions, invalidates pending proofs and queues previous channels', async () => {
      const a = await actor({ email: true, phone: true });
      const otherRaw = newOpaqueToken(); await prisma.session.create({ data: { identityId: a.identity.id, tokenHash: tokenDigest(otherRaw), expiresAt: new Date(Date.now() + 600000) } });
      const emailLogin = await prisma.emailChallenge.create({ data: { email: a.identity.email!, identityId: a.identity.id, tokenHash: tokenDigest(newOpaqueToken()), expiresAt: new Date(Date.now() + 600000), deliveredAt: new Date() } });
      const proof = await emailProof(a);
      const result = await account.verify({ challenge: proof.start.challenge, code: proof.code }, a.context, randomUUID()); assert.ok(result.sessionToken);
      const changed = await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } }); assert.equal(changed.email, proof.email); assert.ok(changed.emailVerifiedAt); assert.equal(changed.phone, a.identity.phone); assert.equal(changed.securityVersion, 1);
      const replacement = await prisma.session.findUniqueOrThrow({ where: { tokenHash: tokenDigest(result.sessionToken!) } });
      assert.notEqual(replacement.familyId, a.session.familyId); assert.equal(replacement.authenticatedAt.getTime(), a.session.authenticatedAt.getTime()); assert.equal(replacement.refreshExpiresAt.getTime(), a.session.refreshExpiresAt.getTime());
      await assert.rejects(nextContext(a.raw), denied(401)); await assert.rejects(nextContext(otherRaw), denied(401));
      await assert.rejects(rotateSession(a.raw), denied(401)); await nextContext(result.sessionToken!); // Old-family replay cannot revoke replacement.
      assert.ok((await prisma.emailChallenge.findUniqueOrThrow({ where: { id: emailLogin.id } })).consumedAt);
      const event = await prisma.identitySecurityEvent.findFirstOrThrow({ where: { identityId: a.identity.id } }); assert.equal(event.action, 'REPLACED'); assert.equal(event.method, 'email');
      const notifications = await prisma.securityNotification.findMany({ where: { eventId: event.id } }); assert.deepEqual(notifications.map(item => item.destination).sort(), [a.identity.email, a.identity.phone].sort()); assert.ok(notifications.every(item => item.status === 'QUEUED' && item.scope === namespace));
      await assert.rejects(prisma.identitySecurityEvent.update({ where: { id: event.id }, data: { action: 'REMOVED' } }));
      await assert.rejects(prisma.identitySecurityEvent.delete({ where: { id: event.id } }));
      await assert.rejects(account.verify({ challenge: proof.start.challenge, code: proof.code }, await nextContext(result.sessionToken!), randomUUID()), denied(400));
    });
    await t.test('contact replacement locks every family before updating a contact key, avoiding refresh foreign-key deadlocks', async () => {
      const a = await actor(); const proof = await emailProof(a);
      const family = randomUUID();
      await prisma.session.create({ data: { identityId: a.identity.id, familyId: family, tokenHash: tokenDigest(newOpaqueToken()), expiresAt: new Date(Date.now() + 600000) } });
      let announce!: () => void, release!: () => void, pid = 0;
      const started = new Promise<void>(resolve => { announce = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const other = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${family}, 0))::text`;
        pid = Number((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
        announce(); await gate;
        return tx.session.create({ data: { identityId: a.identity.id, familyId: family, tokenHash: tokenDigest(newOpaqueToken()), expiresAt: new Date(Date.now() + 600000) } });
      }, { timeout: 10000 });
      await started;
      const changing = account.verify({ challenge: proof.start.challenge, code: proof.code }, a.context, randomUUID());
      const results = Promise.all([other, changing]); // Attach failure handling before releasing the controlled blocker.
      let observed = false;
      try {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          observed = (await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE ${pid}::int = ANY(pg_blocking_pids(a.pid))) AS blocked`)[0]!.blocked;
          if (observed) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { release(); }
      const [rotated, result] = await results;
      assert.equal(observed, true); assert.ok(result.sessionToken);
      assert.ok((await prisma.session.findUniqueOrThrow({ where: { id: rotated.id } })).revokedAt);
    });
    await t.test('owned contact conflicts do not transfer or merge identities, including matching normalized email', async () => {
      const a = await actor(), b = await actor();
      const proof = await emailProof(a, b.identity.email!.toUpperCase());
      await assert.rejects(account.verify({ challenge: proof.start.challenge, code: proof.code }, a.context, randomUUID()), denied(409, 'METHOD_UNAVAILABLE'));
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } })).email, a.identity.email);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: b.identity.id } })).email, b.identity.email);
      assert.equal(await prisma.identitySecurityEvent.count({ where: { identityId: a.identity.id } }), 0);
    });
    await t.test('concurrent valid confirmation has one winner and last usable method cannot be removed', async () => {
      const a = await actor(); const proof = await emailProof(a);
      const results = await Promise.allSettled([1, 2].map(() => account.verify({ challenge: proof.start.challenge, code: proof.code }, a.context, randomUUID())));
      assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
      const result = results.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof account.verify>>>;
      await assert.rejects(account.remove({ method: 'email' }, await nextContext(result.value.sessionToken!)), denied(409, 'LAST_LOGIN_METHOD'));
      assert.equal(await prisma.identitySecurityEvent.count({ where: { identityId: a.identity.id } }), 1);
    });
    await t.test('Google removal is scoped, preserves durable proof history and cannot race away both remaining methods', async () => {
      const a = await actor({ email: true, google: true }), b = await actor({ google: true });
      const ownGoogle = (await account.list(a.context)).methods.find(method => method.method === 'google')!;
      const foreignGoogle = (await account.list(b.context)).methods.find(method => method.method === 'google')!;
      await assert.rejects(account.remove({ method: 'google', id: foreignGoogle.id }, a.context), denied(409, 'METHOD_UNAVAILABLE'));
      await prisma.googleAuthProof.create({ data: { hash: tokenDigest(randomUUID()), identityId: a.identity.id, intent: 'link' } });
      const results = await Promise.allSettled([account.remove({ method: 'google', id: ownGoogle.id }, a.context), account.remove({ method: 'email' }, a.context)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const identity = await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } });
      assert.equal(Number(Boolean(identity.emailVerifiedAt)) + await prisma.externalIdentity.count({ where: { identityId: a.identity.id } }), 1);
      assert.equal(await prisma.googleAuthProof.count({ where: { identityId: a.identity.id } }), 1);
    });
    await t.test('phone proof attaches only to its requesting identity and invalidates old/new login OTPs', async () => {
      const a = await actor({ email: true, phone: true }), phone = `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
      await loginOtp.send(a.identity.phone!, randomUUID()); const oldCode = await loginOtp.localCode(a.identity.phone!);
      await loginOtp.send(phone, randomUUID()); const publicCode = await loginOtp.localCode(phone);
      const start = await account.start({ channel: 'phone', destination: phone }, a.context, randomUUID());
      const code = (await account.localCode(start.challenge, a.context)).code;
      await assert.rejects(account.verify({ challenge: start.challenge, code: publicCode === code ? 'not-a-code' : publicCode }, a.context, randomUUID()));
      const result = await account.verify({ challenge: start.challenge, code }, a.context, randomUUID()); assert.ok(result.sessionToken);
      const identity = await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } }); assert.equal(identity.phone, phone); assert.ok(identity.phoneVerifiedAt);
      await assert.rejects(loginOtp.verify(a.identity.phone!, oldCode, randomUUID())); await assert.rejects(loginOtp.verify(phone, publicCode, randomUUID()));
      const context = await nextContext(result.sessionToken!); const removal = await account.remove({ method: 'phone' }, context); assert.ok(removal.sessionToken);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } })).phone, null);
    });
    await t.test('a phone owned by another identity is never moved or silently merged after proof', async () => {
      const a = await actor(), b = await actor({ phone: true });
      const start = await account.start({ channel: 'phone', destination: b.identity.phone! }, a.context, randomUUID());
      const code = (await account.localCode(start.challenge, a.context)).code;
      await assert.rejects(account.verify({ challenge: start.challenge, code }, a.context, randomUUID()), denied(409, 'METHOD_UNAVAILABLE'));
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } })).phone, null);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: b.identity.id } })).phone, b.identity.phone);
      assert.equal(await prisma.identitySecurityEvent.count({ where: { identityId: a.identity.id } }), 0);
    });
    await t.test('revocation during provider verification prevents a late contact change or replacement session', async () => {
      const a = await actor(); let announce!: () => void, release!: () => void;
      const checking = new Promise<void>(resolve => { announce = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      const provider = { send: async () => ({ sid: `VE${'d'.repeat(32)}`, createdAt: Date.now() }), check: async () => { announce(); await gate; return true; } };
      const privateOtp = createOtpService({ mode: 'twilio', namespace: `${namespace}:revoked-otp`, providerScope: namespace, secret: 'test-only-secret', provider });
      const service = createAccountMethodsService({ delivery, otp: privateOtp, loginOtp, namespace: `${namespace}:revoked` });
      const start = await service.start({ channel: 'phone', destination: '+15557654321' }, a.context, randomUUID());
      const verifying = service.verify({ challenge: start.challenge, code: '123456' }, a.context, randomUUID());
      const rejected = assert.rejects(verifying, denied(401, 'REAUTH_REQUIRED'));
      await checking; await revokeSessionFamily(a.context); release(); await rejected;
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } })).phone, null);
      assert.equal(await prisma.session.count({ where: { identityId: a.identity.id } }), 1);
      assert.equal(await prisma.identitySecurityEvent.count({ where: { identityId: a.identity.id } }), 0);
    });
    await t.test('unverified contact values do not count as usable methods for Google removal', async () => {
      const a = await actor({ google: true });
      await prisma.identity.update({ where: { id: a.identity.id }, data: { email: `${randomUUID()}@example.test`, phone: '+15557654322' } });
      const google = (await account.list(a.context)).methods.find(value => value.method === 'google')!; assert.equal(google.canRemove, false);
      await assert.rejects(account.remove({ method: 'google', id: google.id }, a.context), denied(409, 'LAST_LOGIN_METHOD'));
    });
    await t.test('database ownership constraints reject foreign sessions and foreign audit notification parents', async () => {
      const a = await actor(), b = await actor();
      await assert.rejects(prisma.accountContactChallenge.create({ data: { handleHash: tokenDigest(randomUUID()), identityId: a.identity.id, sessionId: b.session.id, securityVersion: 0, channel: 'email', destination: 'test@example.test', expiresAt: new Date(Date.now() + 1000) } }));
      const event = await prisma.identitySecurityEvent.create({ data: { identityId: b.identity.id, action: 'LINKED', method: 'google' } });
      await assert.rejects(prisma.securityNotification.create({ data: { identityId: a.identity.id, eventId: event.id, channel: 'email', destination: 'test@example.test', scope: namespace } }));
    });
    await t.test('leased outbox acknowledges local/provider acceptance, retries safely, blocks unavailable channels and clears recipients', async () => {
      const a = await actor({ email: true, phone: true }); const proof = await emailProof(a); await account.verify({ challenge: proof.start.challenge, code: proof.code }, a.context, randomUUID());
      let fail = true, sends = 0;
      const worker = createSecurityNotificationWorker({ ...delivery, available: channel => channel === 'email', alert: async () => { sends++; if (fail) throw new Error('private provider response'); return 'test-provider'; } }, namespace);
      for (let batch = 0; batch < 5; batch++) await worker.run();
      const queued = await prisma.securityNotification.findMany({ where: { identityId: a.identity.id } });
      assert.equal(queued.find(item => item.channel === 'email')!.status, 'QUEUED'); assert.equal(queued.find(item => item.channel === 'phone')!.status, 'BLOCKED');
      assert.equal(queued.find(item => item.channel === 'email')!.attempts, 1);
      fail = false; await prisma.securityNotification.updateMany({ where: { identityId: a.identity.id, channel: 'email' }, data: { nextAttemptAt: new Date(Date.now() - 1) } });
      await worker.run();
      const accepted = await prisma.securityNotification.findFirstOrThrow({ where: { identityId: a.identity.id, channel: 'email' } }); assert.equal(accepted.status, 'ACCEPTED'); assert.equal(accepted.destination, null); assert.equal(accepted.provider, 'test-provider'); assert.ok(sends >= 2);
      await prisma.securityNotification.updateMany({ where: { identityId: a.identity.id, channel: 'phone' }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } }); await worker.run();
      const expired = await prisma.securityNotification.findFirstOrThrow({ where: { identityId: a.identity.id, channel: 'phone' } }); assert.equal(expired.status, 'FAILED'); assert.equal(expired.destination, null);
      await worker.stop();
    });
    await t.test('removed email is released only for a newly proven identity, stale links cannot recover the original account and last-method recovery has no bypass', async () => {
      const a = await actor({ email: true, google: true });
      const emailDelivery = createLocalEmailDelivery();
      const emailService = createEmailLoginService({ delivery: emailDelivery, namespace: `${namespace}:email-login` });
      await emailService.send(a.identity.email!, randomUUID());
      const oldLink = await emailService.localMessage(a.identity.email!);
      const removed = await account.remove({ method: 'email' }, a.context); assert.ok(removed.sessionToken);
      await assert.rejects(emailService.verify(oldLink.token, randomUUID()), denied(401));
      await redis.del(`${namespace}:email-login:cooldown:${tokenDigest(a.identity.email!)}`);
      await emailService.send(a.identity.email!, randomUUID());
      const freshLink = await emailService.localMessage(a.identity.email!);
      const priorBootstrap = env.PLATFORM_ADMIN_EMAILS;
      let fresh;
      try {
        env.PLATFORM_ADMIN_EMAILS = a.identity.email!;
        await prisma.identity.update({ where: { id: a.identity.id }, data: { platformRole: 'ADMIN' } });
        fresh = await emailService.verify(freshLink.token, randomUUID()); ids.push(fresh.identity.id);
      } finally { env.PLATFORM_ADMIN_EMAILS = priorBootstrap; }
      assert.equal(fresh!.identity.platformRole, 'USER');
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } })).platformRole, 'ADMIN');
      assert.notEqual(fresh!.identity.id, a.identity.id);
      assert.equal(await prisma.externalIdentity.count({ where: { identityId: a.identity.id, provider: 'google' } }), 1);
      const last = (await account.list(await nextContext(removed.sessionToken!))).methods[0]!;
      await assert.rejects(account.remove({ method: 'google', id: last.id }, await nextContext(removed.sessionToken!)), denied(409, 'LAST_LOGIN_METHOD'));
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/recover', payload: { email: a.identity.email } })).statusCode, 404);
    });
    await t.test('address cooldown crosses actor boundaries and delivery/Redis failures cannot activate pending verification', async () => {
      const a = await actor(), b = await actor(), address = `${randomUUID()}@example.test`;
      const pending = await account.start({ channel: 'email', destination: address }, a.context, randomUUID());
      await assert.rejects(account.start({ channel: 'email', destination: address.toUpperCase() }, b.context, randomUUID()), denied(429));
      assert.ok((await account.localCode(pending.challenge, a.context)).code);
      const broken = createAccountMethodsService({ delivery: { ...delivery, emailVerification: async () => { throw new Error('private provider failure'); } }, otp, loginOtp, namespace });
      await assert.rejects(broken.start({ channel: 'email', destination: `${randomUUID()}@example.test` }, b.context, randomUUID()), denied(503, 'ACCOUNT_DELIVERY_UNAVAILABLE'));
      const failed = await prisma.accountContactChallenge.findFirstOrThrow({ where: { identityId: b.identity.id } }); assert.ok(failed.consumedAt); assert.equal(failed.deliveredAt, null);
      const unavailable = createAccountMethodsService({ delivery, otp, loginOtp, namespace, ready: async () => { throw new Error('private Redis URL'); } });
      await assert.rejects(unavailable.start({ channel: 'email', destination: `${randomUUID()}@example.test` }, b.context, randomUUID()), denied(503, 'ACCOUNT_UNAVAILABLE'));
    });
    await t.test('HTTP mutations issue cookie-only web replacement and deny foreign origin/identity overrides', async () => {
      const a = await actor();
      const start = await app.inject({ method: 'POST', url: '/api/account/contact-challenges', headers: { authorization: `Bearer ${a.raw}`, origin }, payload: { channel: 'email', destination: `${randomUUID()}@example.test`, consent: true } }); assert.equal(start.statusCode, 202);
      const code = (await account.localCode(start.json().challenge, a.context)).code;
      const verified = await app.inject({ method: 'POST', url: '/api/account/contact-challenges/verify', headers: { authorization: `Bearer ${a.raw}`, origin }, payload: { challenge: start.json().challenge, code, consent: true } });
      assert.equal(verified.statusCode, 200); assert.equal(verified.json().sessionToken, undefined); assert.equal(verified.json().identity.id, a.identity.id); assert.match(String(verified.headers['set-cookie']), /HttpOnly/);
    });
  } finally {
    await app.close();
    await prisma.identity.deleteMany({ where: { id: { in: ids } } });
    const keys: string[] = []; for await (const batch of redis.scanStream({ match: `${namespace}:*` })) keys.push(...batch); if (keys.length) await redis.del(...keys);
  }
});

test('account email and alert providers pin endpoints, bound calls and never disclose provider bodies', async () => {
  const calls: { url: string; body: string }[] = [];
  const delivery = createAccountDelivery({ emailMode: 'resend', apiKey: 'private-key', from: 'Visit <login@example.test>', smsMode: 'twilio', messagingServiceSid: `MG${'a'.repeat(32)}`, accountSid: `AC${'a'.repeat(32)}`, authToken: 'private-token', transport: async (url, options) => {
    assert.ok(options?.signal); calls.push({ url: String(url), body: String(options?.body) });
    return String(url).includes('resend') ? Response.json({ id: 'accepted-email' }) : Response.json({ sid: `SM${'a'.repeat(32)}`, status: 'queued' });
  } });
  await delivery.emailVerification({ destination: 'new@example.test', code: '123456', id: 'challenge', locale: 'he' });
  assert.equal(await delivery.alert({ channel: 'email', destination: 'old@example.test', id: 'event-email', locale: 'en' }), 'resend');
  assert.equal(await delivery.alert({ channel: 'phone', destination: '+15551234567', id: 'event-phone', locale: 'he' }), 'twilio');
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails'); assert.match(calls[0]!.body, /123456/); assert.equal(calls[1]!.body.includes('123456'), false); assert.ok(calls[2]!.url.endsWith('/Messages.json'));
  const failed = createAccountDelivery({ emailMode: 'resend', apiKey: 'private-key', transport: async () => { throw new Error('private provider response'); } });
  await assert.rejects(failed.emailVerification({ destination: 'new@example.test', code: '123456', id: 'failed', locale: 'en' }), error => denied(503)(error) && !(error as Error).message.includes('private'));
});

test.after(async () => { redis.disconnect(); await prisma.$disconnect(); });

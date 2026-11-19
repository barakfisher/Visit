import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { createPasswordLoginService, hashPassword, passwordMatches, PASSWORD_MIN_LENGTH, SIGN_IN_LIMITS, SIGN_UP_CODE, SIGN_UP_VERIFY_LIMIT } from '../src/security/password-login.js';
import { createLocalAccountDelivery, type AccountDelivery } from '../src/security/account-delivery.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { createSecurityNotificationWorker } from '../src/security/security-notifications.js';
import { createEmailLoginService, createLocalEmailDelivery } from '../src/security/email-login.js';
import { newOpaqueToken, tokenDigest } from '../src/security/sessions.js';

const emails: string[] = [], namespaces: string[] = [];
const email = () => { const value = `password-${randomUUID()}@example.test`; emails.push(value); return value; };
const password = 'correct horse battery';
const denied = (status: number, code?: string) => (error: unknown) => error instanceof AppError && error.statusCode === status && (!code || error.code === code);
function fixture(options: { delivery?: AccountDelivery; now?: () => number } = {}) {
  const namespace = `visit:password:test:${randomUUID()}`; namespaces.push(namespace);
  const delivery = options.delivery ?? createLocalAccountDelivery();
  return { service: createPasswordLoginService({ namespace, delivery, secret: 'test-only-sign-up-secret', ...(options.now ? { now: options.now } : {}) }), delivery, namespace };
}
type Fixture = ReturnType<typeof fixture>;
/** The code a local sign-up "sent", as the development helper reads it. */
const sentCode = async ({ service }: Fixture, handle: string) => (await service.localSignUpCode(handle)).code;
async function signedUp(f: Fixture, input: { email: string; displayName?: string; password?: string }, ip = randomUUID()) {
  const started = await f.service.startSignUp({ displayName: 'Dana', password, ...input }, ip);
  return f.service.verifySignUp({ signUp: started.signUp, code: (await sentCode(f, started.signUp))! }, ip);
}
/** An account from before slice 1: trusted without proof, its password recording the unproven address. */
async function legacyAccount(address: string) {
  const person = await prisma.identity.create({ data: { email: address, emailVerifiedAt: new Date(), displayName: 'Legacy' } });
  await prisma.passwordCredential.create({ data: { identityId: person.id, hash: await hashPassword(password), unprovenEmail: address } });
  return person;
}
const otherCode = (code: string) => String((Number(code) + 1) % 1000000).padStart(6, '0');
/** Stands in for the 30 seconds passing: Redis keeps real time, so the test removes the cooldown key. */
async function clearCooldown(namespace: string) {
  const keys: string[] = []; for await (const batch of redis.scanStream({ match: `${namespace}:limit:sign-up:address:*:cooldown` })) keys.push(...batch);
  if (keys.length) await redis.del(...keys);
}
after(async () => {
  await prisma.pendingSignUp.deleteMany({ where: { email: { in: emails } } });
  await prisma.emailChallenge.deleteMany({ where: { email: { in: emails } } });
  await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  for (const namespace of namespaces) { const keys: string[] = []; for await (const batch of redis.scanStream({ match: `${namespace}:*` })) keys.push(...batch); if (keys.length) await redis.del(...keys); }
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
});

test('passwords are stored as salted scrypt hashes that only the same password matches', async () => {
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.match(first, /^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await passwordMatches(password, first), true);
  assert.equal(await passwordMatches(`${password}!`, first), false);
  assert.equal(await passwordMatches(password, 'not-a-hash'), false);
});

test('starting sign-up creates no account, only a pending row holding the password hash and an HMAC of the code', async () => {
  const f = fixture(), address = email();
  const started = await f.service.startSignUp({ email: ` ${address.toUpperCase()} `, password, displayName: '  Dana Levi ', locale: 'en' }, randomUUID());
  assert.deepEqual({ ...started, signUp: typeof started.signUp }, { accepted: true, signUp: 'string', expiresInSeconds: SIGN_UP_CODE.lifetimeSeconds, resendAfterSeconds: SIGN_UP_CODE.resendAfterSeconds });
  assert.equal(await prisma.identity.count({ where: { email: address } }), 0);
  const pending = await prisma.pendingSignUp.findUniqueOrThrow({ where: { handleHash: tokenDigest(started.signUp) } });
  const code = (await sentCode(f, started.signUp))!;
  assert.match(code, /^[0-9]{6}$/);
  assert.equal(pending.email, address); assert.equal(pending.displayName, 'Dana Levi'); assert.equal(pending.locale, 'en');
  assert.equal(await passwordMatches(password, pending.passwordHash!), true);
  assert.ok(pending.deliveredAt); assert.equal(pending.consumedAt, null);
  assert.equal(JSON.stringify(pending).includes(code), false);
  assert.equal(JSON.stringify(pending).includes(started.signUp), false);
});

test('the right code creates a verified account with a proven password and one session, once', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  const started = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, ip);
  const code = (await sentCode(f, started.signUp))!;
  const result = await f.service.verifySignUp({ signUp: started.signUp, code }, ip);
  const person = await prisma.identity.findUniqueOrThrow({ where: { email: address }, include: { passwordCredential: true, sessions: true } });
  assert.equal(result.identity.id, person.id);
  assert.equal(person.displayName, 'Dana');
  assert.ok(person.emailVerifiedAt);
  assert.equal(person.platformRole, 'USER');
  assert.equal(await passwordMatches(password, person.passwordCredential!.hash), true);
  assert.equal(person.passwordCredential!.unprovenEmail, null);
  assert.equal(person.sessions.length, 1);
  assert.equal(person.sessions[0]!.tokenHash, tokenDigest(result.token));
  assert.ok((await prisma.pendingSignUp.findUniqueOrThrow({ where: { handleHash: tokenDigest(started.signUp) } })).consumedAt);
  await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code }, ip), denied(410, 'SIGN_UP_EXPIRED'));
  assert.equal(await prisma.identity.count({ where: { email: address } }), 1);
  assert.ok((await f.service.signIn({ email: address, password }, ip)).token);
});

test('a registered address gets the same answer, no code, and an account that sign-up never touches', async () => {
  const f = fixture(), fresh = email(), known = email();
  const existing = await prisma.identity.create({ data: { email: known, emailVerifiedAt: new Date(), displayName: 'Original' } });
  const forFresh = await f.service.startSignUp({ email: fresh, password, displayName: 'Dana' }, randomUUID());
  const forKnown = await f.service.startSignUp({ email: known, password, displayName: 'Intruder' }, randomUUID());
  assert.deepEqual(Object.keys(forKnown).sort(), Object.keys(forFresh).sort());
  assert.deepEqual({ ...forKnown, signUp: '' }, { ...forFresh, signUp: '' });
  assert.deepEqual(await f.service.localSignUpCode(forKnown.signUp), { code: null, existingAccount: true });
  const pending = await prisma.pendingSignUp.findUniqueOrThrow({ where: { handleHash: tokenDigest(forKnown.signUp) } });
  assert.equal(pending.passwordHash, null); assert.equal(pending.codeHash, null); assert.ok(pending.deliveredAt);
  // No code matches: every guess is "incorrect" until the attempts run out, exactly as for a real row.
  for (let attempt = 1; attempt < SIGN_UP_CODE.attempts; attempt++) await assert.rejects(f.service.verifySignUp({ signUp: forKnown.signUp, code: String(attempt).padStart(6, '0') }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  await assert.rejects(f.service.verifySignUp({ signUp: forKnown.signUp, code: '000000' }, randomUUID()), denied(410, 'SIGN_UP_EXPIRED'));
  const unchanged = await prisma.identity.findUniqueOrThrow({ where: { id: existing.id }, include: { passwordCredential: true, sessions: true } });
  assert.equal(unchanged.displayName, 'Original'); assert.equal(unchanged.passwordCredential, null); assert.equal(unchanged.sessions.length, 0);
  // The same per-address cooldown applies to a registered address.
  await assert.rejects(f.service.startSignUp({ email: known, password, displayName: 'Intruder' }, randomUUID()), denied(429, 'RATE_LIMITED'));
});

test('wrong codes count until the fifth, which ends the sign-up even for the right code after it', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  const started = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, ip);
  const code = (await sentCode(f, started.signUp))!;
  for (let attempt = 1; attempt < SIGN_UP_CODE.attempts; attempt++) await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code: otherCode(code) }, ip), denied(400, 'SIGN_UP_CODE_INVALID'));
  assert.equal((await prisma.pendingSignUp.findUniqueOrThrow({ where: { handleHash: tokenDigest(started.signUp) } })).attempts, SIGN_UP_CODE.attempts - 1);
  await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code: otherCode(code) }, ip), denied(410, 'SIGN_UP_EXPIRED'));
  await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code }, ip), denied(410, 'SIGN_UP_EXPIRED'));
  assert.equal(await prisma.identity.count({ where: { email: address } }), 0);

  const second = fixture(), other = email();
  const again = await second.service.startSignUp({ email: other, password, displayName: 'Dana' }, ip);
  const right = (await sentCode(second, again.signUp))!;
  for (let attempt = 1; attempt < SIGN_UP_CODE.attempts; attempt++) await assert.rejects(second.service.verifySignUp({ signUp: again.signUp, code: otherCode(right) }, ip), denied(400, 'SIGN_UP_CODE_INVALID'));
  assert.ok((await second.service.verifySignUp({ signUp: again.signUp, code: right }, ip)).token);
});

test('an expired code, a malformed or unknown handle, and a malformed code are refused without writing', async () => {
  let clock = Date.now();
  const f = fixture({ now: () => clock }), address = email();
  const started = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID());
  const code = (await sentCode(f, started.signUp))!;
  await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code: '12345' }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  assert.equal((await prisma.pendingSignUp.findUniqueOrThrow({ where: { handleHash: tokenDigest(started.signUp) } })).attempts, 0);
  await assert.rejects(f.service.verifySignUp({ signUp: 'not-a-handle', code }, randomUUID()), denied(410, 'SIGN_UP_EXPIRED'));
  await assert.rejects(f.service.verifySignUp({ signUp: newOpaqueToken(), code }, randomUUID()), denied(410, 'SIGN_UP_EXPIRED'));
  clock += SIGN_UP_CODE.lifetimeSeconds * 1000;
  await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code }, randomUUID()), denied(410, 'SIGN_UP_EXPIRED'));
  assert.equal(await prisma.identity.count({ where: { email: address } }), 0);
});

test('sending again supersedes the earlier code, after the cooldown, up to the hourly limit', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  const first = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, ip);
  const firstCode = (await sentCode(f, first.signUp))!;
  await assert.rejects(f.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID()), denied(429, 'RATE_LIMITED'));
  await clearCooldown(f.namespace);
  const second = await f.service.startSignUp({ email: address, password: `${password}!`, displayName: 'Dana Levi' }, ip);
  await assert.rejects(f.service.verifySignUp({ signUp: first.signUp, code: firstCode }, ip), denied(410, 'SIGN_UP_EXPIRED'));
  const result = await f.service.verifySignUp({ signUp: second.signUp, code: (await sentCode(f, second.signUp))! }, ip);
  const person = await prisma.identity.findUniqueOrThrow({ where: { id: result.identity.id }, include: { passwordCredential: true } });
  assert.equal(person.displayName, 'Dana Levi');
  assert.equal(await passwordMatches(`${password}!`, person.passwordCredential!.hash), true);

  const limited = email();
  for (let send = 0; send < SIGN_UP_CODE.sendsPerHour; send++) { await clearCooldown(f.namespace); await f.service.startSignUp({ email: limited, password, displayName: 'Dana' }, randomUUID()); }
  await clearCooldown(f.namespace);
  await assert.rejects(f.service.startSignUp({ email: limited, password, displayName: 'Dana' }, randomUUID()), denied(429, 'RATE_LIMITED'));
});

test('wrong codes for one address add up over a day, so new codes stop before guessing can succeed', async () => {
  const f = fixture(), address = email();
  for (let failures = 0; failures < SIGN_UP_CODE.failuresPerDay;) {
    await clearCooldown(f.namespace);
    const started = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID());
    const code = (await sentCode(f, started.signUp))!;
    for (let attempt = 0; attempt < SIGN_UP_CODE.attempts && failures < SIGN_UP_CODE.failuresPerDay; attempt++, failures++) await assert.rejects(f.service.verifySignUp({ signUp: started.signUp, code: otherCode(code) }, randomUUID()));
  }
  await clearCooldown(f.namespace);
  await assert.rejects(f.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID()), denied(429, 'RATE_LIMITED'));
  assert.ok(await f.service.startSignUp({ email: email(), password, displayName: 'Dana' }, randomUUID()));
});

test('past the daily count, a code already sent stops working too, even the right one', async () => {
  const f = fixture(), address = email();
  const open = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID());
  const right = (await sentCode(f, open.signUp))!;
  // Reaching the count by other sign-ups' wrong codes is covered above; here it is set directly.
  await redis.set(`${f.namespace}:limit:sign-up:address:${createHash('sha256').update(address).digest('hex')}:failed`, String(SIGN_UP_CODE.failuresPerDay));
  await assert.rejects(f.service.verifySignUp({ signUp: open.signUp, code: right }, randomUUID()), denied(410, 'SIGN_UP_EXPIRED'));
  assert.equal(await prisma.identity.count({ where: { email: address } }), 0);
});

test('a right code works only with its own sign-up', async () => {
  const f = fixture(), first = email(), second = email();
  const a = await f.service.startSignUp({ email: first, password, displayName: 'Dana' }, randomUUID());
  const b = await f.service.startSignUp({ email: second, password, displayName: 'Dana' }, randomUUID());
  const codeA = (await sentCode(f, a.signUp))!, codeB = (await sentCode(f, b.signUp))!;
  if (codeA !== codeB) await assert.rejects(f.service.verifySignUp({ signUp: b.signUp, code: codeA }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  assert.equal(await prisma.identity.count({ where: { email: { in: [first, second] } } }), 0);
});

test('the cleanup removes pending sign-ups a day after they expire and keeps newer ones', async () => {
  const old = email(), recent = email();
  await prisma.pendingSignUp.createMany({ data: [
    { handleHash: tokenDigest(newOpaqueToken()), email: old, displayName: 'Old', locale: 'he', expiresAt: new Date(Date.now() - 2 * 86400000) },
    { handleHash: tokenDigest(newOpaqueToken()), email: recent, displayName: 'Recent', locale: 'he', expiresAt: new Date(Date.now() - 3600000) },
  ] });
  const worker = createSecurityNotificationWorker(createLocalAccountDelivery(), `test:sign-up-cleanup:${randomUUID()}`);
  await worker.run(); await worker.stop();
  assert.equal(await prisma.pendingSignUp.count({ where: { email: old } }), 0);
  assert.equal(await prisma.pendingSignUp.count({ where: { email: recent } }), 1);
});

test('two verifications of one code create one account, and an address registered meanwhile is not taken over', async () => {
  const f = fixture(), address = email();
  const started = await f.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID());
  const code = (await sentCode(f, started.signUp))!;
  const results = await Promise.allSettled([f.service.verifySignUp({ signUp: started.signUp, code }, randomUUID()), f.service.verifySignUp({ signUp: started.signUp, code }, randomUUID())]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected' && denied(410, 'SIGN_UP_EXPIRED')(item.reason)).length, 1);
  assert.equal(await prisma.identity.count({ where: { email: address } }), 1);

  const raced = email();
  const pending = await f.service.startSignUp({ email: raced, password, displayName: 'Late' }, randomUUID());
  const owner = await prisma.identity.create({ data: { email: raced, emailVerifiedAt: new Date(), displayName: 'Owner by link' } });
  await assert.rejects(f.service.verifySignUp({ signUp: pending.signUp, code: (await sentCode(f, pending.signUp))! }, randomUUID()), denied(409, 'EMAIL_TAKEN'));
  const unchanged = await prisma.identity.findUniqueOrThrow({ where: { id: owner.id }, include: { passwordCredential: true, sessions: true } });
  assert.equal(unchanged.displayName, 'Owner by link'); assert.equal(unchanged.passwordCredential, null); assert.equal(unchanged.sessions.length, 0);
});

test('sign-up rejects a short password, a missing name, an invalid email and an unknown locale before writing', async () => {
  const f = fixture(), address = email();
  await assert.rejects(f.service.startSignUp({ email: address, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1), displayName: 'Dana' }, randomUUID()), ZodError);
  await assert.rejects(f.service.startSignUp({ email: address, password, displayName: ' ' }, randomUUID()), ZodError);
  await assert.rejects(f.service.startSignUp({ email: 'not-an-email', password, displayName: 'Dana' }, randomUUID()), ZodError);
  await assert.rejects(f.service.startSignUp({ email: address, password, displayName: 'Dana', locale: 'fr' }, randomUUID()), ZodError);
  assert.equal(await prisma.pendingSignUp.count({ where: { email: address } }), 0);
});

test('a failed or unconfigured delivery leaves no usable sign-up, and Redis failure sends nothing', async () => {
  const local = createLocalAccountDelivery();
  const failing = fixture({ delivery: { ...local, signUp: async () => { throw new Error('private provider failure'); } } }), address = email();
  await assert.rejects(failing.service.startSignUp({ email: address, password, displayName: 'Dana' }, randomUUID()), error => denied(503, 'ACCOUNT_DELIVERY_UNAVAILABLE')(error) && !(error as Error).message.includes('private'));
  const failed = await prisma.pendingSignUp.findFirstOrThrow({ where: { email: address } });
  assert.ok(failed.consumedAt); assert.equal(failed.deliveredAt, null);

  const off = fixture({ delivery: { ...local, available: () => false } }), unconfigured = email();
  await assert.rejects(off.service.startSignUp({ email: unconfigured, password, displayName: 'Dana' }, randomUUID()), denied(503, 'METHOD_NOT_CONFIGURED'));
  assert.equal(await prisma.pendingSignUp.count({ where: { email: unconfigured } }), 0);

  let sent = 0;
  const down = createPasswordLoginService({ namespace: `visit:password:test:${randomUUID()}`, delivery: { ...local, signUp: async () => { sent++; } }, ready: async () => { throw new Error('redis down'); } }), unreachable = email();
  await assert.rejects(down.startSignUp({ email: unreachable, password, displayName: 'Dana' }, randomUUID()), denied(503, 'AUTH_TEMPORARILY_UNAVAILABLE'));
  await assert.rejects(down.verifySignUp({ signUp: newOpaqueToken(), code: '123456' }, randomUUID()), denied(503, 'AUTH_TEMPORARILY_UNAVAILABLE'));
  await assert.rejects(down.signIn({ email: unreachable, password }, randomUUID()), denied(503, 'AUTH_TEMPORARILY_UNAVAILABLE'));
  assert.equal(sent, 0);
  assert.equal(await prisma.pendingSignUp.count({ where: { email: unreachable } }), 0);
});

test('code guesses are limited per IP across sign-ups', async () => {
  const f = fixture(), ip = randomUUID();
  for (let attempt = 0; attempt < SIGN_UP_VERIFY_LIMIT.maximum; attempt++) await assert.rejects(f.service.verifySignUp({ signUp: newOpaqueToken(), code: '123456' }, ip), denied(410, 'SIGN_UP_EXPIRED'));
  await assert.rejects(f.service.verifySignUp({ signUp: newOpaqueToken(), code: '123456' }, ip), denied(429, 'RATE_LIMITED'));
});

test('sign-in issues a session only for the right password, with one error for every failure', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  const { identity } = await signedUp(f, { email: address }, ip);
  const signedIn = await f.service.signIn({ email: address.toUpperCase(), password }, ip);
  assert.equal(signedIn.identity.id, identity.id);
  assert.equal(await prisma.session.count({ where: { identityId: identity.id } }), 2);
  const linkOnly = email(); await prisma.identity.create({ data: { email: linkOnly, emailVerifiedAt: new Date() } });
  for (const attempt of [{ email: address, password: `${password}!` }, { email: email(), password }, { email: linkOnly, password }, { email: 'not-an-email', password }, { email: address, password: 'short' }]) {
    await assert.rejects(f.service.signIn(attempt, ip), denied(401, 'INVALID_CREDENTIALS'));
  }
  assert.equal(await prisma.session.count({ where: { identityId: identity.id } }), 2);
});

test('failed passwords throttle that address from that IP, while correct sign-ins never count', async () => {
  const f = fixture(), address = email(), attacker = randomUUID(), owner = randomUUID();
  await signedUp(f, { email: address });
  for (let attempt = 0; attempt < SIGN_IN_LIMITS.addressFromIp.maximum + 2; attempt++) await f.service.signIn({ email: address, password }, owner);
  for (let attempt = 0; attempt < SIGN_IN_LIMITS.addressFromIp.maximum; attempt++) await assert.rejects(f.service.signIn({ email: address, password: `${password}!` }, attacker), denied(401));
  await assert.rejects(f.service.signIn({ email: address, password }, attacker), denied(429, 'RATE_LIMITED'));
  // Someone else guessing the address from another IP does not lock its owner out.
  assert.ok((await f.service.signIn({ email: address, password }, owner)).token);
});

test('the real owner proving an address by email link ends a password set before sign-up needed proof', async () => {
  const f = fixture(), address = email();
  const squatter = await legacyAccount(address);
  const squatterSession = await f.service.signIn({ email: address, password }, randomUUID());
  const links = createEmailLoginService({ delivery: createLocalEmailDelivery(), namespace: `visit:email:test:${randomUUID()}` });
  await links.send(address, randomUUID());
  const owner = await links.verify((await links.localMessage(address)).token, randomUUID());
  assert.equal(owner.identity.id, squatter.id);
  assert.equal(await prisma.passwordCredential.count({ where: { identityId: owner.identity.id } }), 0);
  assert.equal(await prisma.session.count({ where: { identityId: owner.identity.id, revokedAt: null } }), 1);
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { tokenHash: tokenDigest(squatterSession.token) } })).revokedAt instanceof Date, true);
  await assert.rejects(f.service.signIn({ email: address, password }, randomUUID()), denied(401, 'INVALID_CREDENTIALS'));
});

test('an account created by the code keeps its password when its owner later signs in by email link', async () => {
  const f = fixture(), address = email();
  const created = await signedUp(f, { email: address });
  const links = createEmailLoginService({ delivery: createLocalEmailDelivery(), namespace: `visit:email:test:${randomUUID()}` });
  await links.send(address, randomUUID());
  assert.equal((await links.verify((await links.localMessage(address)).token, randomUUID())).identity.id, created.identity.id);
  assert.equal(await prisma.passwordCredential.count({ where: { identityId: created.identity.id } }), 1);
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { tokenHash: tokenDigest(created.token) } })).revokedAt, null);
});

test('/v1/me returns the account name and whether each managed business is published', async () => {
  const app = Fastify(), f = fixture();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ code: error instanceof AppError ? error.code : 'generic' }));
  await registerAuthRoutes(app, { passwordLogin: f.service });
  const slug = `me-${randomUUID()}`, publishedAt = new Date();
  try {
    const address = email();
    const started = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: address, password, displayName: 'Dana' } });
    const verified = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/verify', payload: { signUp: started.json().signUp, code: await sentCode(f, started.json().signUp) } });
    const cookie = verified.cookies.find(item => item.name.endsWith('visit_session'))!;
    const business = await prisma.business.create({ data: { name: 'Me fixture', slug, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt } });
    await prisma.membership.create({ data: { identityId: verified.json().identity.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().identity.displayName, 'Dana');
    assert.equal(me.json().memberships[0].business.publishedAt, publishedAt.toISOString());
    assert.equal(JSON.stringify(me.json()).includes(password), false);
  } finally { await prisma.business.deleteMany({ where: { slug } }); await app.close(); }
});

test('HTTP routes: sign-up answers 202 without a session or code, the code issues the cookie, and input is bounded', async () => {
  const app = Fastify(), f = fixture();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ code: error instanceof AppError ? error.code : 'generic' }));
  await registerAuthRoutes(app, { passwordLogin: f.service });
  try {
    const address = email();
    const started = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: address, password, displayName: 'Dana', locale: 'he' } });
    assert.equal(started.statusCode, 202);
    assert.equal(started.cookies.length, 0);
    const code = (await sentCode(f, started.json().signUp))!;
    assert.equal(started.body.includes(code), false); assert.equal(started.body.includes(password), false);
    const wrong = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/verify', payload: { signUp: started.json().signUp, code: otherCode(code) } });
    assert.equal(wrong.statusCode, 400); assert.equal(wrong.json().code, 'SIGN_UP_CODE_INVALID');
    const verified = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/verify', payload: { signUp: started.json().signUp, code } });
    assert.equal(verified.statusCode, 201);
    assert.ok(verified.cookies.some(cookie => cookie.name.endsWith('visit_session')));
    assert.equal(verified.json().identity.email, address);
    // A registered address: the same 202, never EMAIL_TAKEN.
    await clearCooldown(f.namespace);
    const known = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: address, password, displayName: 'Dana' } });
    assert.equal(known.statusCode, 202); assert.deepEqual(Object.keys(known.json()).sort(), Object.keys(started.json()).sort());
    const short = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: email(), password: 'short', displayName: 'Dana' } });
    assert.equal(short.statusCode, 400); assert.equal(short.json().code, 'VALIDATION_ERROR');
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: email(), password, displayName: 'Dana', platformRole: 'ADMIN' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/verify', payload: { signUp: started.json().signUp, code, extra: true } })).statusCode, 400);
    // The development helper exists only in development, never under tests or in production.
    assert.equal((await app.inject({ method: 'POST', url: '/__dev/sign-up-code', payload: { signUp: started.json().signUp } })).statusCode, 404);
    const signIn = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-in', payload: { email: address, password } });
    assert.equal(signIn.statusCode, 200); assert.equal(signIn.json().identity.email, address);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-in', payload: { email: address, password: 'wrong password' } })).json().code, 'INVALID_CREDENTIALS');
  } finally { await app.close(); }
});

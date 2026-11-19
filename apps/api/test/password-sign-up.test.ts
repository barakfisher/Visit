import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { env } from '../src/env.js';
import { AppError } from '../src/http/errors.js';
import { passwordMatches, PASSWORD_MIN_LENGTH, SIGN_UP_LIMIT } from '../src/security/password-login.js';
import { createPasswordSignUpService, SIGN_UP_ADDRESS_LIMIT, SIGN_UP_CODE_ATTEMPTS, SIGN_UP_CODE_SECONDS, SIGN_UP_RESEND_SECONDS, SIGN_UP_VERIFY_LIMIT, SIGN_UP_WRONG_CODES_PER_ADDRESS } from '../src/security/password-sign-up.js';
import { createLocalSignUpDelivery, createSignUpDelivery, signUpEmail, type SignUpDelivery } from '../src/security/sign-up-delivery.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { createEmailLoginService, createLocalEmailDelivery } from '../src/security/email-login.js';
import { createPasswordLoginService } from '../src/security/password-login.js';
import { tokenDigest } from '../src/security/sessions.js';

const emails: string[] = [], namespaces: string[] = [];
const email = () => { const value = `sign-up-${randomUUID()}@example.test`; emails.push(value); return value; };
const password = 'correct horse battery';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = (status: number, code?: string) => (error: unknown) => error instanceof AppError && error.statusCode === status && (!code || error.code === code);
// Every test gets its own Redis namespace and an injected local inbox: no test sends real mail.
function fixture(options: { delivery?: SignUpDelivery; now?: () => number; ready?: () => Promise<void> } = {}) {
  const namespace = `visit:password:test:${randomUUID()}`; namespaces.push(namespace);
  const delivery = options.delivery ?? createLocalSignUpDelivery();
  const sent: { destination: string; kind: string; locale: string }[] = [];
  const counted: SignUpDelivery = { ...delivery, async send(input) { sent.push({ destination: input.destination, kind: input.message.kind, locale: input.locale }); return delivery.send(input); } };
  const service = createPasswordSignUpService({ delivery: counted, namespace, secret: 'test-only-sign-up-secret', ...(options.now ? { now: options.now } : {}), ...(options.ready ? { ready: options.ready } : {}) });
  const clearCooldown = (address: string) => redis.del(`${namespace}:sign-up:address:${sha(address)}:cooldown`);
  const code = async (pendingId: string) => { const message = await service.localMessage(pendingId); assert.ok('code' in message); return message.code; };
  return { service, sent, namespace, clearCooldown, code };
}
const wrong = (code: string) => code === '000000' ? '111111' : '000000';
after(async () => {
  await prisma.pendingSignUp.deleteMany({ where: { email: { in: emails } } });
  await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  for (const namespace of namespaces) { const keys: string[] = []; for await (const batch of redis.scanStream({ match: `${namespace}:*` })) keys.push(...batch); if (keys.length) await redis.del(...keys); }
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
});

test('sign-up creates nothing until the emailed code is right, then a verified account with a proven password and a session', async () => {
  const frozen = Date.now(), { service, sent, code } = fixture({ now: () => frozen }), address = email();
  const pending = await service.signUp({ email: ` ${address.toUpperCase()} `, password, displayName: '  Dana Levi ', locale: 'en' }, randomUUID());
  assert.deepEqual(Object.keys(pending).sort(), ['accepted', 'expiresInSeconds', 'pendingId', 'resendAfterSeconds']);
  assert.equal(pending.expiresInSeconds, SIGN_UP_CODE_SECONDS); assert.equal(pending.resendAfterSeconds, SIGN_UP_RESEND_SECONDS);
  assert.equal(await prisma.identity.count({ where: { email: address } }), 0);
  const row = await prisma.pendingSignUp.findFirstOrThrow({ where: { email: address } });
  const value = await code(pending.pendingId);
  // Only digests are stored: the handle, the code and the password never appear as given.
  assert.notEqual(row.handleHash, pending.pendingId); assert.equal(row.codeHash?.includes(value), false); assert.equal(row.passwordHash?.includes(password), false);
  assert.deepEqual(sent, [{ destination: address, kind: 'code', locale: 'en' }]);
  const created = await service.verify({ pendingId: pending.pendingId, code: value }, randomUUID());
  const person = await prisma.identity.findUniqueOrThrow({ where: { email: address }, include: { passwordCredential: true, sessions: true } });
  assert.equal(created.identity.id, person.id); assert.equal(person.displayName, 'Dana Levi'); assert.equal(person.preferredLocale, 'en');
  assert.ok(person.emailVerifiedAt); assert.equal(person.platformRole, 'USER');
  assert.equal(person.passwordCredential!.unprovenEmail, null);
  assert.equal(await passwordMatches(password, person.passwordCredential!.hash), true);
  assert.deepEqual(person.sessions.map(item => item.tokenHash), [tokenDigest(created.token)]);
  const consumed = await prisma.pendingSignUp.findUniqueOrThrow({ where: { id: row.id } });
  assert.ok(consumed.consumedAt); assert.equal(consumed.passwordHash, null); assert.equal(consumed.codeHash, null);
  await assert.rejects(service.verify({ pendingId: pending.pendingId, code: value }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  // A proven password survives the owner's own email link: "the real owner wins" has nothing to take.
  const links = createEmailLoginService({ delivery: createLocalEmailDelivery(), namespace: `visit:email:test:${randomUUID()}` });
  await links.send(address, randomUUID()); await links.verify((await links.localMessage(address)).token, randomUUID());
  assert.ok((await createPasswordLoginService({ namespace: `visit:password:test:${randomUUID()}` }).signIn({ email: address, password }, randomUUID())).token);
});

test('a registered address gets the same answer, "you already have an account" in its owner\'s language, and nothing it can verify', async () => {
  const { service, sent } = fixture(), address = email();
  const owner = await prisma.identity.create({ data: { email: address, emailVerifiedAt: new Date(), displayName: 'Original', preferredLocale: 'en' } });
  const known = await service.signUp({ email: address, password, displayName: 'Intruder', locale: 'he' }, randomUUID());
  const unknown = await service.signUp({ email: email(), password, displayName: 'Someone', locale: 'he' }, randomUUID());
  assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
  assert.equal(known.expiresInSeconds, unknown.expiresInSeconds); assert.equal(known.resendAfterSeconds, unknown.resendAfterSeconds);
  assert.deepEqual(sent[0], { destination: address, kind: 'existing-account', locale: 'en' });
  assert.equal(sent[1]!.kind, 'code');
  assert.deepEqual(await service.localMessage(known.pendingId), { existingAccount: true });
  const row = await prisma.pendingSignUp.findFirstOrThrow({ where: { email: address } });
  assert.equal(row.existingAccount, true); assert.equal(row.passwordHash, null); assert.equal(row.codeHash, null);
  for (let attempt = 1; attempt < SIGN_UP_CODE_ATTEMPTS; attempt++) await assert.rejects(service.verify({ pendingId: known.pendingId, code: String(attempt).padStart(6, '0') }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  await assert.rejects(service.verify({ pendingId: known.pendingId, code: '999999' }, randomUUID()), denied(400, 'SIGN_UP_TOO_MANY_ATTEMPTS'));
  const unchanged = await prisma.identity.findUniqueOrThrow({ where: { id: owner.id }, include: { passwordCredential: true, sessions: true } });
  assert.equal(unchanged.displayName, 'Original'); assert.equal(unchanged.passwordCredential, null); assert.equal(unchanged.sessions.length, 0);
  // The cooldown and hourly cap apply to a registered address exactly as to a new one.
  await assert.rejects(service.signUp({ email: address, password, displayName: 'Intruder' }, randomUUID()), denied(429, 'RATE_LIMITED'));
});

test('wrong, exhausted, expired, unknown and foreign codes are refused, and attempts always count', async () => {
  let clock = Date.now();
  const { service, code } = fixture({ now: () => clock });
  const first = await service.signUp({ email: email(), password, displayName: 'Dana' }, randomUUID());
  const value = await code(first.pendingId);
  for (let attempt = 1; attempt < SIGN_UP_CODE_ATTEMPTS; attempt++) await assert.rejects(service.verify({ pendingId: first.pendingId, code: wrong(value) }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  await assert.rejects(service.verify({ pendingId: first.pendingId, code: wrong(value) }, randomUUID()), denied(400, 'SIGN_UP_TOO_MANY_ATTEMPTS'));
  await assert.rejects(service.verify({ pendingId: first.pendingId, code: value }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  assert.equal((await prisma.pendingSignUp.findFirstOrThrow({ where: { handleHash: tokenDigest(first.pendingId) } })).passwordHash, null);

  const second = await service.signUp({ email: email(), password, displayName: 'Dana' }, randomUUID());
  const third = await service.signUp({ email: email(), password, displayName: 'Dana' }, randomUUID());
  // The code for one pending sign-up never opens another.
  await assert.rejects(service.verify({ pendingId: third.pendingId, code: await code(second.pendingId) }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  await assert.rejects(service.verify({ pendingId: 'A'.repeat(43), code: '123456' }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  await assert.rejects(service.verify({ pendingId: 'short', code: '123456' }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  const secondCode = await code(second.pendingId);
  clock += SIGN_UP_CODE_SECONDS * 1000 + 1;
  await assert.rejects(service.verify({ pendingId: second.pendingId, code: secondCode }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  await assert.rejects(service.resend(second.pendingId, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  assert.equal(await prisma.identity.count({ where: { email: { in: emails } , displayName: 'Dana' } }), 0);
});

test('a new sign-up for the address supersedes the old one, and resend replaces the code on the same pending sign-up', async () => {
  const { service, code, clearCooldown, sent } = fixture(), address = email();
  const first = await service.signUp({ email: address, password, displayName: 'First' }, randomUUID());
  const firstCode = await code(first.pendingId);
  await assert.rejects(service.resend(first.pendingId, randomUUID()), denied(429, 'RATE_LIMITED'));
  await clearCooldown(address);
  await service.resend(first.pendingId, randomUUID());
  const resent = await code(first.pendingId);
  assert.equal(sent.length, 2);
  if (resent !== firstCode) await assert.rejects(service.verify({ pendingId: first.pendingId, code: firstCode }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  await clearCooldown(address);
  const second = await service.signUp({ email: address, password: `${password}!`, displayName: 'Second' }, randomUUID());
  await assert.rejects(service.verify({ pendingId: first.pendingId, code: resent }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  await assert.rejects(service.resend(first.pendingId, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  const created = await service.verify({ pendingId: second.pendingId, code: await code(second.pendingId) }, randomUUID());
  const person = await prisma.identity.findUniqueOrThrow({ where: { id: created.identity.id }, include: { passwordCredential: true } });
  assert.equal(person.displayName, 'Second'); assert.equal(await passwordMatches(`${password}!`, person.passwordCredential!.hash), true);
});

test('resend gives fresh attempts and keeps the hourly cap per address', async () => {
  const { service, code, clearCooldown } = fixture(), address = email();
  const pending = await service.signUp({ email: address, password, displayName: 'Dana' }, randomUUID());
  for (let attempt = 1; attempt < SIGN_UP_CODE_ATTEMPTS; attempt++) await assert.rejects(service.verify({ pendingId: pending.pendingId, code: wrong(await code(pending.pendingId)) }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  for (let send = 1; send < SIGN_UP_ADDRESS_LIMIT.maximum; send++) { await clearCooldown(address); await service.resend(pending.pendingId, randomUUID()); }
  assert.equal((await prisma.pendingSignUp.findFirstOrThrow({ where: { handleHash: tokenDigest(pending.pendingId) } })).attempts, 0);
  await clearCooldown(address);
  await assert.rejects(service.resend(pending.pendingId, randomUUID()), denied(429, 'RATE_LIMITED'));
  assert.ok((await service.verify({ pendingId: pending.pendingId, code: await code(pending.pendingId) }, randomUUID())).token);
});

test('wrong codes for one address are capped over a day across resends and IPs, registered or not', async () => {
  const { service, code, clearCooldown } = fixture();
  for (const registered of [false, true]) {
    const address = email();
    if (registered) await prisma.identity.create({ data: { email: address, emailVerifiedAt: new Date() } });
    let pending = await service.signUp({ email: address, password, displayName: 'Dana' }, randomUUID());
    const guess = async () => { const value = registered ? '123456' : wrong(await code(pending.pendingId)); return service.verify({ pendingId: pending.pendingId, code: value }, randomUUID()); };
    for (let attempt = 0; attempt < SIGN_UP_WRONG_CODES_PER_ADDRESS.maximum; attempt++) {
      if (attempt && attempt % SIGN_UP_CODE_ATTEMPTS === 0) { await clearCooldown(address); pending = await service.signUp({ email: address, password, displayName: 'Dana' }, randomUUID()); }
      await assert.rejects(guess(), denied(400));
    }
    await clearCooldown(address); pending = await service.signUp({ email: address, password, displayName: 'Dana' }, randomUUID());
    await assert.rejects(guess(), denied(429, 'RATE_LIMITED'));
    if (!registered) await assert.rejects(service.verify({ pendingId: pending.pendingId, code: await code(pending.pendingId) }, randomUUID()), denied(429, 'RATE_LIMITED'));
  }
});

test('an address taken while the code was pending answers "sign in" only after the right code, and never a second account', async () => {
  const { service, code } = fixture(), address = email();
  const pending = await service.signUp({ email: address, password, displayName: 'Late' }, randomUUID());
  const owner = await prisma.identity.create({ data: { email: address, emailVerifiedAt: new Date(), displayName: 'Owner' } });
  const value = await code(pending.pendingId);
  await assert.rejects(service.verify({ pendingId: pending.pendingId, code: wrong(value) }, randomUUID()), denied(400, 'SIGN_UP_CODE_INVALID'));
  await assert.rejects(service.verify({ pendingId: pending.pendingId, code: value }, randomUUID()), denied(409, 'ACCOUNT_EXISTS'));
  await assert.rejects(service.verify({ pendingId: pending.pendingId, code: value }, randomUUID()), denied(400, 'SIGN_UP_EXPIRED'));
  const unchanged = await prisma.identity.findUniqueOrThrow({ where: { id: owner.id }, include: { passwordCredential: true, sessions: true } });
  assert.equal(unchanged.displayName, 'Owner'); assert.equal(unchanged.passwordCredential, null); assert.equal(unchanged.sessions.length, 0);
  assert.equal(await prisma.identity.count({ where: { email: address } }), 1);
});

test('simultaneous verifications of the right code create one account', async () => {
  const { service, code } = fixture(), address = email();
  const pending = await service.signUp({ email: address, password, displayName: 'Dana' }, randomUUID());
  const value = await code(pending.pendingId);
  const results = await Promise.allSettled([service.verify({ pendingId: pending.pendingId, code: value }, randomUUID()), service.verify({ pendingId: pending.pendingId, code: value }, randomUUID())]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected' && denied(400, 'SIGN_UP_EXPIRED')(item.reason)).length, 1);
  assert.equal(await prisma.identity.count({ where: { email: address } }), 1);
});

test('limits per IP and for verification, validation before writes, Redis outage and missing or failing delivery leave nothing usable', async () => {
  const { service } = fixture(), ip = randomUUID();
  for (let attempt = 0; attempt < SIGN_UP_LIMIT.maximum; attempt++) await service.signUp({ email: email(), password, displayName: 'Dana' }, ip);
  await assert.rejects(service.signUp({ email: email(), password, displayName: 'Dana' }, ip), denied(429, 'RATE_LIMITED'));
  const verifier = randomUUID();
  for (let attempt = 0; attempt < SIGN_UP_VERIFY_LIMIT.maximum; attempt++) await assert.rejects(service.verify({ pendingId: 'A'.repeat(43), code: '123456' }, verifier), denied(400));
  await assert.rejects(service.verify({ pendingId: 'A'.repeat(43), code: '123456' }, verifier), denied(429, 'RATE_LIMITED'));

  const invalid = email();
  await assert.rejects(service.signUp({ email: invalid, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1), displayName: 'Dana' }, randomUUID()), ZodError);
  await assert.rejects(service.signUp({ email: invalid, password, displayName: ' ' }, randomUUID()), ZodError);
  await assert.rejects(service.signUp({ email: invalid, password, displayName: 'Dana', locale: 'fr' }, randomUUID()), ZodError);
  await assert.rejects(service.signUp({ email: 'not-an-email', password, displayName: 'Dana' }, randomUUID()), ZodError);

  const redisDown = fixture({ ready: async () => { throw new Error('private Redis URL'); } }), offline = email();
  await assert.rejects(redisDown.service.signUp({ email: offline, password, displayName: 'Dana' }, randomUUID()), denied(503, 'AUTH_TEMPORARILY_UNAVAILABLE'));
  assert.equal(redisDown.sent.length, 0);

  const unconfigured = fixture({ delivery: createSignUpDelivery({ emailMode: 'resend', apiKey: undefined, transport: async () => { throw new Error('must not be called'); } }) });
  await assert.rejects(unconfigured.service.signUp({ email: offline, password, displayName: 'Dana' }, randomUUID()), denied(503, 'METHOD_NOT_CONFIGURED'));

  const failing = fixture({ delivery: { ...createLocalSignUpDelivery(), async send() { throw new Error('private provider failure'); } } }), failed = email();
  await assert.rejects(failing.service.signUp({ email: failed, password, displayName: 'Dana' }, randomUUID()), denied(503, 'EMAIL_DELIVERY_FAILED'));
  const row = await prisma.pendingSignUp.findFirstOrThrow({ where: { email: failed } });
  assert.ok(row.consumedAt); assert.equal(row.deliveredAt, null); assert.equal(row.passwordHash, null);
  assert.equal(await prisma.pendingSignUp.count({ where: { email: invalid } }) + await prisma.pendingSignUp.count({ where: { email: offline } }), 0);
  assert.equal(await prisma.identity.count({ where: { email: { in: [invalid, offline, failed] } } }), 0);
});

test('sign-up emails are Hebrew or English, carry no link, and the provider never sees the code in a header', async () => {
  const calls: { headers: Record<string, string>; body: { subject: string; text: string; to: string[] } }[] = [];
  const delivery = createSignUpDelivery({ emailMode: 'resend', apiKey: 'test-only-key', from: 'Visit <test@example.test>', transport: async (_url, init) => { calls.push({ headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) }); return new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }); } });
  assert.equal(delivery.available(), true); assert.equal(delivery.local, false);
  await delivery.send({ id: 'row', sendId: 'send-1', destination: 'dana@example.test', locale: 'he', message: { kind: 'code', code: '482913' } });
  await delivery.send({ id: 'row', sendId: 'send-2', destination: 'dana@example.test', locale: 'en', message: { kind: 'existing-account' } });
  assert.equal(calls[0]!.body.subject, signUpEmail('he', { kind: 'code', code: '482913' }).subject); assert.match(calls[0]!.body.text, /482913/);
  assert.equal(calls[1]!.body.subject, signUpEmail('en', { kind: 'existing-account' }).subject);
  for (const call of calls) { assert.doesNotMatch(call.body.text, /https?:|visit:\/\//); assert.equal(JSON.stringify(call.headers).includes('482913'), false); }
  assert.deepEqual(calls.map(call => call.headers['Idempotency-Key']), ['sign-up/send-1', 'sign-up/send-2']);
  const broken = createSignUpDelivery({ emailMode: 'resend', apiKey: 'test-only-key', transport: async () => new Response('private provider body', { status: 500 }) });
  await assert.rejects(broken.send({ id: 'row', sendId: 'send-3', destination: 'dana@example.test', locale: 'en', message: { kind: 'code', code: '000000' } }), denied(503, 'EMAIL_DELIVERY_FAILED'));
  assert.equal(createSignUpDelivery({ emailMode: 'resend', apiKey: undefined }).available(), false);
});

test('HTTP routes answer 202, sign in only after the code, reject extra fields, and the code helper is loopback development only', async () => {
  const { service } = fixture();
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ code: error instanceof AppError ? error.code : 'generic' }));
  await registerAuthRoutes(app, { passwordSignUp: service });
  const previous = env.NODE_ENV;
  try {
    const address = email();
    const started = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: address, password, displayName: 'Dana', locale: 'he' } });
    assert.equal(started.statusCode, 202); assert.equal(started.cookies.length, 0); assert.equal(JSON.stringify(started.json()).includes(password), false);
    const pendingId = started.json().pendingId as string;
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: email(), password, displayName: 'Dana', platformRole: 'ADMIN' } })).statusCode, 400);
    const short = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up', payload: { email: email(), password: 'short', displayName: 'Dana' } });
    assert.equal(short.statusCode, 400); assert.equal(short.json().code, 'VALIDATION_ERROR');
    env.NODE_ENV = 'test';
    assert.equal((await app.inject({ method: 'POST', url: '/__dev/auth/sign-up-code', payload: { pendingId } })).statusCode, 404);
    env.NODE_ENV = 'development';
    assert.equal((await app.inject({ method: 'POST', url: '/__dev/auth/sign-up-code', payload: { pendingId }, remoteAddress: '203.0.113.9' })).statusCode, 404);
    const helper = await app.inject({ method: 'POST', url: '/__dev/auth/sign-up-code', payload: { pendingId } });
    assert.equal(helper.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/verify', payload: { pendingId, code: 'abc' } })).json().code, 'SIGN_UP_CODE_INVALID');
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/resend', payload: { pendingId: 'nope' } })).json().code, 'SIGN_UP_EXPIRED');
    const verified = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-up/verify', payload: { pendingId, code: helper.json().code } });
    assert.equal(verified.statusCode, 201); assert.equal(verified.json().identity.email, address);
    assert.ok(verified.cookies.some(cookie => cookie.name.endsWith('visit_session')));
    assert.equal(JSON.stringify(verified.json()).includes(password), false);
  } finally { env.NODE_ENV = previous; await app.close(); }
});

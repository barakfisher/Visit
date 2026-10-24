import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { env } from '../src/env.js';
import { AppError } from '../src/http/errors.js';
import { createEmailLoginService, createLocalEmailDelivery, createResendEmailDelivery, emailLoginLink, emailSchema, type EmailDelivery, type EmailMessage } from '../src/security/email-login.js';
import { newOpaqueToken, tokenDigest } from '../src/security/sessions.js';
import { registerAuthRoutes } from '../src/routes/auth.js';

const emails: string[] = [], namespaces: string[] = [];
const email = () => { const value = `email-${randomUUID()}@example.test`; emails.push(value); return value; };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = (status: number) => (error: unknown) => error instanceof AppError && error.statusCode === status;
function fixture(delivery: EmailDelivery = createLocalEmailDelivery()) {
  const namespace = `visit:email:test:${randomUUID()}`; namespaces.push(namespace); let now = Date.now();
  const service = createEmailLoginService({ delivery, namespace, webOrigin: 'https://visit.example', now: () => now });
  return { namespace, service, advance: (ms: number) => { now += ms; }, cooldown: (address: string) => redis.del(`${namespace}:cooldown:${hash(address)}`) };
}
after(async () => {
  await prisma.emailChallenge.deleteMany({ where: { email: { in: emails } } });
  await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  for (const namespace of namespaces) { const keys: string[] = []; for await (const batch of redis.scanStream({ match: `${namespace}:*` })) keys.push(...batch); if (keys.length) await redis.del(...keys); }
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
});

test('email links use canonical addresses, fixed allowlisted destinations and fragment credentials', () => {
  assert.equal(emailSchema.parse(' Person@Example.Test '), 'person@example.test');
  const token = newOpaqueToken();
  const web = new URL(emailLoginLink(token, 'web', 'https://visit.example'));
  assert.equal(web.origin, 'https://visit.example'); assert.equal(web.pathname, '/auth/email'); assert.equal(web.searchParams.has('token'), false); assert.equal(new URLSearchParams(web.hash.slice(1)).get('token'), token);
  assert.match(emailLoginLink(token, 'native', 'https://visit.example'), /^visit:\/\/auth\/email#token=/);
});

test('ownership is activated once after explicit verification, including simultaneous link use', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  const result = await f.service.send(address, ip); assert.equal(result.accepted, true);
  assert.equal(await prisma.identity.findUnique({ where: { email: address } }), null);
  const message = await f.service.localMessage(address);
  const record = await prisma.emailChallenge.findUniqueOrThrow({ where: { tokenHash: tokenDigest(message.token) } });
  assert.ok(record.deliveredAt); assert.notEqual(record.tokenHash, message.token);
  const verified = await Promise.allSettled([f.service.verify(message.token, ip), f.service.verify(message.token, ip)]);
  assert.equal(verified.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(verified.filter(item => item.status === 'rejected' && denied(401)(item.reason)).length, 1);
  const person = await prisma.identity.findUniqueOrThrow({ where: { email: address } }); assert.ok(person.emailVerifiedAt);
  assert.equal(await prisma.session.count({ where: { identityId: person.id } }), 1);
  await assert.rejects(f.service.verify(message.token, ip), denied(401));
});

test('invalid/expired links cannot create identity or sessions', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  await f.service.send(address, ip); const message = await f.service.localMessage(address);
  await assert.rejects(f.service.verify(newOpaqueToken(), ip), denied(401));
  const otherPurpose = newOpaqueToken();
  await prisma.emailChallenge.create({ data: { email: address, tokenHash: tokenDigest(otherPurpose), purpose: 'EMAIL_VERIFY', deliveredAt: new Date(), expiresAt: new Date(Date.now() + 900000) } });
  await assert.rejects(f.service.verify(otherPurpose, ip), denied(401));
  f.advance(900001); await assert.rejects(f.service.verify(message.token, ip), denied(401));
  assert.equal(await prisma.identity.findUnique({ where: { email: address } }), null);
});

test('recovery sends a new proof, invalidates the prior link and preserves current account roles', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  const person = await prisma.identity.create({ data: { email: address, platformRole: 'ADMIN' } });
  await f.service.send(address, ip); const old = await f.service.localMessage(address);
  await f.cooldown(address); await f.service.send(address, ip); const recovery = await f.service.localMessage(address);
  await assert.rejects(f.service.verify(old.token, ip), denied(401));
  const result = await f.service.verify(recovery.token, ip);
  assert.equal(result.identity.id, person.id); assert.equal(result.identity.platformRole, 'ADMIN');
  assert.equal(await prisma.identity.count({ where: { email: address } }), 1);
});

test('a link cannot activate while delivery is pending and a failed delivery is burned', async () => {
  let message: EmailMessage | undefined, release: (() => void) | undefined, started: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const f = fixture({ mode: 'resend', send: async value => { message = value; started!(); await new Promise<void>(resolve => { release = resolve; }); } });
  const address = email(), ip = randomUUID();
  const sending = f.service.send(address, ip); await ready;
  await assert.rejects(f.service.verify(message!.token, ip), denied(401));
  release!(); await sending; assert.ok((await f.service.verify(message!.token, ip)).token);
  const failed = fixture({ mode: 'resend', send: async value => { message = value; throw new Error('private-provider-secret'); } });
  const other = email();
  await assert.rejects(failed.service.send(other, ip), (error: unknown) => error instanceof AppError && error.statusCode === 503 && !error.message.includes('private'));
  await assert.rejects(failed.service.verify(message!.token, ip), denied(401));
  const row = await prisma.emailChallenge.findUniqueOrThrow({ where: { tokenHash: tokenDigest(message!.token) } });
  assert.ok(row.consumedAt); assert.equal(row.deliveredAt, null);
});

test('identity binding rejects a changed or newly claimed email without merging accounts', async () => {
  const f = fixture(), address = email(), replacementAddress = email(), ip = randomUUID();
  const owner = await prisma.identity.create({ data: { email: address } });
  await f.service.send(address, ip); const message = await f.service.localMessage(address);
  await prisma.identity.update({ where: { id: owner.id }, data: { email: replacementAddress } });
  const replacement = await prisma.identity.create({ data: { email: address } });
  await assert.rejects(f.service.verify(message.token, ip), denied(401));
  assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: replacement.id } })).emailVerifiedAt, null);
  assert.equal(await prisma.session.count({ where: { identityId: { in: [owner.id, replacement.id] } } }), 0);
  const unclaimed = email(); await f.service.send(unclaimed, ip); const anonymous = await f.service.localMessage(unclaimed);
  await prisma.identity.create({ data: { email: unclaimed } });
  await assert.rejects(f.service.verify(anonymous.token, ip), denied(401));
});

test('send/verify quotas, cooldown and Redis failures are enforced before activation', async () => {
  const f = fixture(), address = email(), ip = randomUUID();
  await f.service.send(address, ip); await assert.rejects(f.service.send(address, ip), denied(429));
  for (let count = 0; count < 3; count++) { await f.cooldown(address); await f.service.send(address, ip); }
  await f.cooldown(address); await assert.rejects(f.service.send(address, ip), denied(429));
  const shared = randomUUID();
  for (let count = 0; count < 10; count++) await f.service.send(email(), shared);
  await assert.rejects(f.service.send(email(), shared), denied(429));
  const brute = randomUUID();
  for (let count = 0; count < 20; count++) await assert.rejects(f.service.verify(newOpaqueToken(), brute), denied(401));
  await assert.rejects(f.service.verify(newOpaqueToken(), brute), denied(429));
  const unavailable = createEmailLoginService({ delivery: createLocalEmailDelivery(), ready: async () => { throw new Error('Redis private connection'); } });
  const blocked = email(); await assert.rejects(unavailable.send(blocked, randomUUID()), denied(503));
  assert.equal(await prisma.emailChallenge.count({ where: { email: blocked } }), 0);
});

test('Resend adapter uses a bounded request and stable delivery idempotency without exposing errors', async () => {
  const message: EmailMessage = { email: email(), token: newOpaqueToken(), link: 'https://visit.example/auth/email#token=synthetic-token', id: randomUUID(), expiresAt: Date.now() + 900000 };
  const delivery = createResendEmailDelivery({ apiKey: 'private-key', from: 'Visit <login@example.test>', transport: async (url, init) => {
    assert.equal(String(url), 'https://api.resend.com/emails'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), `email-login/${message.id}`);
    const body = JSON.parse(String(init?.body)); assert.equal(body.to[0], message.email); assert.ok(body.text.includes(message.link)); assert.equal(body.apiKey, undefined);
    return new Response(JSON.stringify({ id: 'delivery-id' }));
  } });
  await delivery.send(message);
  for (const status of [401, 429, 500]) {
    const broken = createResendEmailDelivery({ apiKey: 'private-key', from: 'sender', transport: async () => new Response('private-provider-body', { status }) });
    await assert.rejects(broken.send(message), (error: unknown) => error instanceof AppError && error.statusCode === 503 && !error.message.includes('private'));
  }
});

test('HTTP send responses resist enumeration and reject redirect injection; mailbox remains local/development only', async () => {
  const f = fixture(), app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ error: 'generic' }));
  await registerAuthRoutes(app, { emailLogin: f.service });
  try {
    const known = email(), unknown = email(); await prisma.identity.create({ data: { email: known } });
    const send = (address: string, extra = {}) => app.inject({ method: 'POST', url: '/v1/auth/email-challenges', payload: { email: address, ...extra } });
    const a = await send(known), b = await send(unknown); assert.equal(a.statusCode, 202); assert.deepEqual(a.json(), b.json());
    assert.equal((await send(email(), { redirectUri: 'https://evil.test' })).statusCode, 400);
    assert.equal((await send(email(), { target: 'https://evil.test' })).statusCode, 400);
    assert.equal((await app.inject({ url: `/__dev/mailbox?email=${encodeURIComponent(known)}`, remoteAddress: '198.51.100.10', headers: { 'x-forwarded-for': '127.0.0.1' } })).statusCode, 403);
    const previous = env.NODE_ENV; env.NODE_ENV = 'production';
    try { assert.equal((await app.inject({ url: `/__dev/mailbox?email=${encodeURIComponent(known)}` })).statusCode, 404); }
    finally { env.NODE_ENV = previous; }
  } finally { await app.close(); }
});

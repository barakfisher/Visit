import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { createOtpService, createTwilioProvider, phoneSchema, type VerifyProvider } from '../src/security/phone-otp.js';
import { registerFlowAuth } from '../src/routes/flow-auth.js';
import { safeErrorLog, safeRequestLog } from '../src/security/logging.js';

const namespaces: string[] = [];
const phone = () => `+1555${randomInt(1000000, 9999999)}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = (status: number) => (error: unknown) => error instanceof AppError && error.statusCode === status;
function fixture(mode: 'local-inbox' | 'twilio' = 'local-inbox', provider?: VerifyProvider) {
  const namespace = `visit:otp:test:${randomUUID()}`; namespaces.push(namespace);
  let now = Date.now();
  const service = createOtpService({ mode, secret: 'fixture-secret-with-at-least-32-characters', namespace, providerScope: namespace, now: () => now, ...(provider ? { provider } : {}) });
  const keys = (number: string) => ({ challenge: `${namespace}:challenge:${hash(number)}`, inbox: `${namespace}:inbox:${hash(number)}`, cooldown: `${namespace}:cooldown:${hash(number)}`, operation: `${namespace}:operation:${hash(number)}` });
  return { namespace, service, keys, advance: (ms: number) => { now += ms; }, code: async (number: string) => (await redis.get(keys(number).inbox))! };
}
after(async () => {
  for (const namespace of namespaces) {
    const keys: string[] = [];
    for await (const batch of redis.scanStream({ match: `${namespace}:*` })) keys.push(...batch);
    if (keys.length) await redis.del(...keys);
  }
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
});

test('E.164 canonicalization requires an explicit country code', () => {
  assert.equal(phoneSchema.parse(' +972 (50) 123-4567 '), '+972501234567');
  for (const value of ['0501234567', '00972501234567', '+0123456789', '+1x5551234567', '+123', '+1234567890123456']) assert.equal(phoneSchema.safeParse(value).success, false);
});

test('development OTP hashes use nonce binding, bounded expiry and atomic single-use consumption', async () => {
  const f = fixture(), number = phone(), ip = randomUUID();
  const sent = await f.service.send(number, ip);
  assert.equal(sent.resendAfterSeconds, 30); assert.equal(sent.expiresInSeconds, 300);
  const code = await f.code(number); assert.match(code, /^\d{6}$/);
  const challenge = JSON.parse((await redis.get(f.keys(number).challenge))!);
  assert.match(challenge.digest, /^[\da-f]{64}$/); assert.equal(challenge.code, undefined);
  assert.ok((await redis.pttl(f.keys(number).challenge)) <= 300000);
  await assert.rejects(f.service.send(number, ip), denied(429));
  const results = await Promise.allSettled([f.service.verify(number, code, ip), f.service.verify(number, code, ip)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await redis.get(f.keys(number).challenge), null); assert.equal(await f.code(number), null);
  await assert.rejects(f.service.verify(number, code, ip), denied(401));
});

test('five attempts exhaust a challenge and resending never accepts an expired generation', async () => {
  const f = fixture(), number = phone(), ip = randomUUID();
  await f.service.send(number, ip); const code = await f.code(number);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(f.service.verify(number, wrong, ip), denied(401));
  await assert.rejects(f.service.verify(number, code, ip), denied(401));
  assert.equal(JSON.parse((await redis.get(f.keys(number).challenge))!).attempts, 5);
  const expired = phone(); await f.service.send(expired, randomUUID());
  const expiredCode = await f.code(expired); f.advance(300001);
  await assert.rejects(f.service.verify(expired, expiredCode, randomUUID()), denied(401));
});

test('resend refreshes local nonce; send and verify limits are independent per phone and IP', async () => {
  const f = fixture(), number = phone(), ip = randomUUID();
  await f.service.send(number, ip); const first = JSON.parse((await redis.get(f.keys(number).challenge))!);
  await redis.del(f.keys(number).cooldown); await f.service.send(number, ip);
  const second = JSON.parse((await redis.get(f.keys(number).challenge))!); assert.notEqual(first.id, second.id);
  for (let index = 0; index < 3; index++) { await redis.del(f.keys(number).cooldown); await f.service.send(number, ip); }
  await redis.del(f.keys(number).cooldown); await assert.rejects(f.service.send(number, ip), denied(429));
  const sharedIp = randomUUID();
  for (let index = 0; index < 10; index++) await f.service.send(phone(), sharedIp);
  await assert.rejects(f.service.send(phone(), sharedIp), denied(429));
  const missing = phone();
  for (let index = 0; index < 8; index++) await assert.rejects(f.service.verify(missing, '000000', randomUUID()), denied(401));
  await assert.rejects(f.service.verify(missing, '000000', randomUUID()), denied(429));
  const verifyIp = randomUUID();
  for (let index = 0; index < 30; index++) await assert.rejects(f.service.verify(phone(), '000000', verifyIp), denied(401));
  await assert.rejects(f.service.verify(phone(), '000000', verifyIp), denied(429));
});

test('Twilio checks are serialized, bind SID and consume approval once across resends', async () => {
  const sid = `VE${randomUUID().replaceAll('-', '')}`, createdAt = Date.now(); let checks = 0;
  const f = fixture('twilio', { send: async () => ({ sid, createdAt }), check: async (suppliedSid, code) => { assert.equal(suppliedSid, sid); assert.equal(code, '123456'); checks++; await new Promise(resolve => setTimeout(resolve, 20)); return true; } });
  const number = phone(), ip = randomUUID(); await f.service.send(number, ip);
  assert.equal(await f.code(number), null);
  const results = await Promise.allSettled([f.service.verify(number, '123456', ip), f.service.verify(number, '123456', ip)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(checks, 1);
  await redis.del(f.keys(number).cooldown); await f.service.send(number, ip);
  await assert.rejects(f.service.verify(number, '123456', ip), denied(401));
});

test('Twilio resend preserves attempt cap and original validity deadline', async () => {
  const sid = `VE${randomUUID().replaceAll('-', '')}`, createdAt = Date.now();
  const f = fixture('twilio', { send: async () => ({ sid, createdAt }), check: async () => false });
  const number = phone(), ip = randomUUID(); await f.service.send(number, ip);
  await assert.rejects(f.service.verify(number, '123456', ip), denied(401));
  f.advance(30000); await redis.del(f.keys(number).cooldown); await f.service.send(number, ip);
  const record = JSON.parse((await redis.get(f.keys(number).challenge))!);
  assert.equal(record.attempts, 1); assert.ok(record.expiresAt <= createdAt + 600000);
  f.advance(600000); await assert.rejects(f.service.verify(number, '123456', ip), denied(401));
});

test('provider/Redis failure and expired operation ownership fail closed', async () => {
  let sends = 0;
  const unavailable = createOtpService({ mode: 'twilio', secret: 'test', ready: async () => { throw new Error('offline'); }, provider: { send: async () => { sends++; throw new Error('should not call'); }, check: async () => true } });
  await assert.rejects(unavailable.send(phone(), randomUUID()), denied(503)); assert.equal(sends, 0);
  const sid = `VE${randomUUID().replaceAll('-', '')}`;
  const f = fixture('twilio', { send: async () => ({ sid, createdAt: Date.now() }), check: async () => { await redis.set(f.keys(number).operation, 'replacement-owner', 'PX', 30000); return true; } });
  const number = phone(); await f.service.send(number, randomUUID());
  await assert.rejects(f.service.verify(number, '123456', randomUUID()), denied(401));
  assert.equal(await redis.get(f.keys(number).operation), 'replacement-owner');
  const failing = fixture('twilio', { send: async () => { throw new Error('credential details must not leak'); }, check: async () => false });
  await assert.rejects(failing.service.send(phone(), randomUUID()), (error: unknown) => error instanceof AppError && error.statusCode === 503 && !error.message.includes('credential'));
});

test('durable session proof rejects repeated provider approval even after Redis replay keys are lost', async () => {
  const sid = `VE${randomUUID().replaceAll('-', '')}`;
  const f = fixture('twilio', { send: async () => ({ sid, createdAt: Date.now() }), check: async () => true });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' } }));
  await registerFlowAuth(app, { otp: f.service });
  const number = phone();
  try {
    const send = () => app.inject({ method: 'POST', url: '/api/auth/otp/send', payload: { phone: number } });
    const verify = () => app.inject({ method: 'POST', url: '/api/auth/otp/verify', headers: { 'x-visit-client': 'native' }, payload: { phone: number, code: '123456' } });
    assert.equal((await send()).statusCode, 202);
    const result = await verify(); assert.equal(result.statusCode, 200); assert.ok(result.json().sessionToken);
    const identity = await prisma.identity.findUniqueOrThrow({ where: { phone: number } }); assert.ok(identity.phoneVerifiedAt);
    const first = await prisma.session.findFirstOrThrow({ where: { identityId: identity.id } }); assert.match(first.authenticationProofHash!, /^[\da-f]{64}$/);
    await redis.del(`${f.namespace}:used:${first.authenticationProofHash}`, f.keys(number).cooldown);
    assert.equal((await send()).statusCode, 202);
    assert.equal((await verify()).statusCode, 401);
    assert.equal(await prisma.session.count({ where: { identityId: identity.id } }), 1);
  } finally { await app.close(); await prisma.identity.deleteMany({ where: { phone: number } }); }
});

test('Twilio HTTP adapter pins verification SID and sanitizes provider errors', async () => {
  const sid = `VE${randomUUID().replaceAll('-', '')}`;
  const make = (status: number, body: unknown) => createTwilioProvider({ accountSid: 'AC-test', authToken: 'do-not-log-secret', serviceSid: 'VA-test', transport: async (_url, init) => {
    assert.ok(init?.signal); assert.equal(new URLSearchParams(String(init?.body)).get('VerificationSid'), sid);
    return new Response(JSON.stringify(body), { status });
  } });
  assert.equal(await make(200, { sid, status: 'approved' }).check(sid, '123456'), true);
  assert.equal(await make(200, { sid: 'foreign', status: 'approved' }).check(sid, '123456'), false);
  assert.equal(await make(404, {}).check(sid, '123456'), false);
  await assert.rejects(make(429, { message: 'private provider message' }).check(sid, '123456'), denied(429));
  await assert.rejects(make(500, { message: 'private provider message' }).check(sid, '123456'), (error: unknown) => error instanceof AppError && error.statusCode === 503 && !error.message.includes('private'));
});

test('authentication log metadata excludes query strings, phone/code and provider input', () => {
  const query = safeRequestLog({ method: 'GET', url: '/__dev/otp?phone=private-phone&code=private-code' });
  const error = safeErrorLog({ message: 'private-phone private-code private-secret', code: 'P2002', meta: { token: 'private-secret' } });
  assert.deepEqual(query, { method: 'GET', url: '/__dev/otp' }); assert.deepEqual(error, { category: 'unexpected_error', code: 'P2002' });
  assert.equal(JSON.stringify({ query, error }).includes('private-'), false);
});


test('production rejects development delivery and malformed Twilio credentials without exposing values', () => {
  for (const override of [
    { SMS_DELIVERY_MODE: 'local-inbox' },
    { SMS_DELIVERY_MODE: 'twilio', TWILIO_ACCOUNT_SID: 'invalid-private-value', TWILIO_AUTH_TOKEN: 'invalid-private-value', TWILIO_VERIFY_SERVICE_SID: 'invalid-private-value' },
  ]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/env.ts')"], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', EMAIL_DELIVERY_MODE: 'resend', EMAIL_API_KEY: 'fake-private-provider-key', WEB_APP_URL: 'https://visit.example', ...override } });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /SMS_DELIVERY_MODE/);
    assert.doesNotMatch(result.stderr, /invalid-private-value|fake-private-provider-key/);
  }
});


test('contact invalidation prevents an in-flight provider send from restoring an obsolete OTP', async () => {
  let announce!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const provider = { send: async () => { announce(); await new Promise<void>(resolve => { finish = resolve; }); return { sid: `VE${'b'.repeat(32)}`, createdAt: Date.now() }; }, check: async () => true };
  const f = fixture('twilio', provider), number = phone();
  const sending = f.service.send(number, randomUUID());
  // Attach rejection before the externally controlled send completes.
  const rejected = assert.rejects(sending, denied(503));
  await started; await f.service.invalidate(number); finish(); await rejected;
  assert.equal(await redis.get(f.keys(number).challenge), null);
  await assert.rejects(f.service.verify(number, '123456', randomUUID()), denied(401));
});

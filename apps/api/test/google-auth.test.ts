import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { createGoogleAuthService, createGoogleProvider, s256, validateGoogleClaims, type GoogleConfig } from '../src/security/google-auth.js';
import { authenticate, newOpaqueToken, tokenDigest, type AuthenticatedSession } from '../src/security/sessions.js';
import { AppError } from '../src/http/errors.js';
import { prisma } from '../src/db/client.js';
import { redis, ensureRedisReady } from '../src/infra/redis.js';
import { registerFlowAuth } from '../src/routes/flow-auth.js';
import { registerRequestSecurity } from '../src/security/request-security.js';

const config: GoogleConfig = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'server-only-test-secret', callbackUrl: 'https://api.example.test/api/auth/google/callback', webOrigin: 'https://visit.example.test', nativeReturnUrl: 'visit://auth/google' };
const denied = (status: number, code?: string) => (error: unknown) => error instanceof AppError && error.statusCode === status && (!code || error.code === code);
const claims = (nonce: string, fields: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: config.clientId, sub: 'subject', email: 'owner@example.test', email_verified: true, nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...fields });

test('Google claims require exact issuer/audience/nonce and strictly valid verified identity and times', () => {
  const good = claims('nonce'); assert.equal(validateGoogleClaims(good, config.clientId, 'nonce').subject, 'subject');
  for (const bad of [{ iss: 'https://accounts.google.com.attacker.test' }, { aud: 'other-client' }, { aud: [config.clientId] }, { azp: 'other-client' }, { nonce: 'wrong' }, { exp: Math.floor(Date.now() / 1000) }, { iat: Math.floor(Date.now() / 1000) + 120 }, { email_verified: 'true' }, { email_verified: false }, { sub: '' }, { email: 'invalid' }]) assert.throws(() => validateGoogleClaims({ ...good, ...bad }, config.clientId, 'nonce'), denied(401));
  assert.equal(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('Google provider exchanges code with S256 verifier, validates real RSA signatures and caches bounded certificates', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims('nonce'))).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), keys.privateKey).toString('base64url')}`;
  let tokenCalls = 0, certCalls = 0, tamper = false;
  const request: typeof fetch = async (url, options) => {
    assert.ok(options?.signal); assert.ok(['https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v1/certs'].includes(String(url)));
    if (String(url).endsWith('/token')) {
      tokenCalls++; const body = new URLSearchParams(String(options?.body));
      assert.equal(body.get('code_verifier'), 'private-verifier'); assert.equal(body.get('client_secret'), config.clientSecret); assert.equal(body.get('redirect_uri'), config.callbackUrl);
      return Response.json({ id_token: tamper ? jwt.replace(payload, Buffer.from(JSON.stringify(claims('nonce', { sub: 'tampered' }))).toString('base64url')) : jwt, access_token: 'discard-me' });
    }
    certCalls++; return Response.json({ 'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  };
  const provider = createGoogleProvider(config, request);
  assert.equal((await provider.exchange({ code: 'one-time-code', verifier: 'private-verifier', redirectUri: config.callbackUrl })).sub, 'subject');
  await provider.exchange({ code: 'second-code', verifier: 'private-verifier', redirectUri: config.callbackUrl });
  assert.equal(tokenCalls, 2); assert.equal(certCalls, 1);
  tamper = true; await assert.rejects(provider.exchange({ code: 'bad-signature', verifier: 'private-verifier', redirectUri: config.callbackUrl }), error => denied(503)(error) && !(error as Error).message.includes(jwt));
  await assert.rejects(createGoogleProvider(config, async () => { throw new Error('provider body contains a secret'); }).exchange({ code: 'private-code', verifier: 'private-verifier', redirectUri: config.callbackUrl }), error => denied(503)(error) && !(error as Error).message.includes('secret'));
});

test('invalid Google redirect/secret configuration fails with field-only diagnostics', () => {
  for (const callback of ['private-malformed-callback', 'https://attacker.test/wrong-path', 'http://remote.test/api/auth/google/callback', 'https://user:private-password@api.test/api/auth/google/callback']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import './src/env.ts'"], { env: { ...process.env, GOOGLE_CLIENT_ID: config.clientId, GOOGLE_CLIENT_SECRET: config.clientSecret, GOOGLE_CALLBACK_URL: callback }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.ok(result.stderr.includes('GOOGLE_CALLBACK_URL')); assert.equal(result.stderr.includes(callback), false); assert.equal(result.stderr.includes(config.clientSecret), false);
  }
});

test('Google broker uses owned one-time state/grants and explicit transactional linking without email merging', async t => {
  const run = randomUUID(), namespace = `test:google:${run}`;
  let clockOffset = 0, exchanges = 0;
  const responses = new Map<string, Record<string, unknown>>();
  const google = createGoogleAuthService({ config, namespace, now: () => Date.now() + clockOffset, provider: { exchange: async ({ code, verifier, redirectUri }) => {
    exchanges++; assert.equal(redirectUri, config.callbackUrl); assert.ok(/^[A-Za-z0-9_-]{43}$/.test(verifier));
    const response = responses.get(code); if (!response) throw new Error('bad code'); return response;
  } } });
  const app = Fastify(); registerRequestSecurity(app, config.webOrigin);
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'VALIDATION_ERROR' } }));
  await registerFlowAuth(app, { google });
  let actorResult: AuthenticatedSession | undefined;
  app.get('/__test/actor', async request => { actorResult = await authenticate(request); return {}; });
  const ids = new Set<string>();
  const email = (label: string, domain = 'example.test') => `${label}-${run}@${domain}`;
  const recordKey = (kind: string, value: string) => `${namespace}:${kind}:${tokenDigest(value)}`;
  const cookies = (binding: string) => `visit_google_binding=${binding}`;
  async function actor(primaryEmail: string | null, role: 'USER' | 'ADMIN' = 'USER', age = 0) {
    const identity = await prisma.identity.create({ data: { email: primaryEmail, platformRole: role } }); ids.add(identity.id);
    const token = newOpaqueToken();
    await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), authenticatedAt: new Date(Date.now() - age), expiresAt: new Date(Date.now() + 600000) } });
    await app.inject({ url: '/__test/actor', headers: { authorization: `Bearer ${token}` } });
    return { identity, token, context: actorResult! };
  }
  async function proof(subject: string, address: string, options: { actor?: AuthenticatedSession; native?: boolean; bad?: Record<string, unknown> } = {}) {
    const verifier = newOpaqueToken(), clientState = newOpaqueToken();
    const start = await google.begin({ platform: options.native ? 'native' : 'web', intent: options.actor ? 'link' : 'login', ...(options.actor ? { consent: true } : {}), ...(options.native ? { challenge: s256(verifier), clientState } : {}) }, randomUUID(), options.actor);
    let authorizationUrl: string, binding: string;
    if (options.native) {
      const ticket = new URL(start.authorizationUrl).searchParams.get('ticket')!;
      const launched = await google.authorize(ticket, randomUUID()); authorizationUrl = launched.authorizationUrl; binding = launched.binding;
      await assert.rejects(google.authorize(ticket, randomUUID()), denied(401));
    } else { authorizationUrl = start.authorizationUrl; binding = start.binding!; }
    const query = new URL(authorizationUrl).searchParams;
    assert.equal(query.get('code_challenge_method'), 'S256'); assert.equal(query.get('response_type'), 'code'); assert.equal(query.get('scope'), 'openid email');
    assert.equal(query.has('client_secret'), false); assert.equal(query.has('code_verifier'), false);
    const code = randomUUID(); responses.set(code, claims(query.get('nonce')!, { sub: subject, email: address, ...options.bad }));
    const state = query.get('state')!;
    // Wrong browser binding must not consume a legitimate pending callback.
    await assert.rejects(google.callback({ state, code }, newOpaqueToken(), randomUUID()), denied(401));
    const target = new URL(await google.callback({ state, code }, binding, randomUUID()));
    await assert.rejects(google.callback({ state, code }, binding, randomUUID()), denied(401));
    const receipt = new URLSearchParams(target.hash.slice(1)).get('grant');
    return { grant: receipt!, target, binding, verifier, clientState };
  }
  try {
    await ensureRedisReady();
    await t.test('web login is single-use, browser-bound and backed by durable proof replay prevention', async () => {
      const result = await proof(`subject-${run}`, email('first'));
      assert.equal(result.target.origin, config.webOrigin); assert.equal(result.target.pathname, '/auth/google'); assert.equal(result.target.search, '');
      assert.ok(result.grant); assert.deepEqual(await google.preview({ grant: result.grant }, result.binding, randomUUID()), { email: email('first'), intent: 'login' });
      await assert.rejects(google.finish({ grant: result.grant }, newOpaqueToken(), randomUUID()), denied(401));
      const raw = (await redis.get(recordKey('grant', result.grant)))!;
      const [a, b] = await Promise.allSettled([google.finish({ grant: result.grant }, result.binding, randomUUID()), google.finish({ grant: result.grant }, result.binding, randomUUID())]);
      assert.equal([a, b].filter(item => item.status === 'fulfilled').length, 1);
      const successful = [a, b].find(item => item.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof google.finish>>>; ids.add(successful.value.identityId);
      await redis.set(recordKey('grant', result.grant), raw, 'EX', 120);
      await assert.rejects(google.finish({ grant: result.grant }, result.binding, randomUUID()), denied(401));
      assert.equal(await prisma.session.count({ where: { identityId: successful.value.identityId } }), 1);
      const changed = await proof(`subject-${run}`, email('changed'));
      const login = await google.finish({ grant: changed.grant }, changed.binding, randomUUID()); assert.equal(login.identityId, successful.value.identityId);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: login.identityId } })).email, email('first'));
      assert.equal(await prisma.identity.count({ where: { email: email('changed') } }), 0);
    });
    await t.test('all existing email matches require explicit linking, including authoritative Gmail addresses', async () => {
      const existing = await actor(email('existing', 'gmail.com'), 'ADMIN');
      const result = await proof(`gmail-${run}`, existing.identity.email!);
      await assert.rejects(google.finish({ grant: result.grant }, result.binding, randomUUID()), denied(409, 'LINK_REQUIRED'));
      assert.equal(await prisma.externalIdentity.count({ where: { identityId: existing.identity.id } }), 0);
      const unchanged = await prisma.identity.findUniqueOrThrow({ where: { id: existing.identity.id } }); assert.equal(unchanged.platformRole, 'ADMIN'); assert.equal(unchanged.emailVerifiedAt, null);
      const link = await proof(`gmail-${run}`, existing.identity.email!, { actor: existing.context });
      assert.equal((await google.preview({ grant: link.grant }, link.binding, randomUUID(), existing.context)).intent, 'link');
      await assert.rejects(google.finish({ grant: link.grant }, link.binding, randomUUID(), existing.context), denied(400, 'LINK_CONSENT_REQUIRED'));
      const linked = await google.finish({ grant: link.grant, consent: true }, link.binding, randomUUID(), existing.context);
      assert.equal('sessionToken' in linked, false); assert.equal(linked.identityId, existing.identity.id);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: existing.identity.id } })).emailVerifiedAt, null);
      const workspace = await actor(email('workspace'));
      const workspaceProof = await proof(`workspace-${run}`, workspace.identity.email!, { bad: { hd: 'example.test' } });
      await assert.rejects(google.finish({ grant: workspaceProof.grant }, workspaceProof.binding, randomUUID()), denied(409, 'LINK_REQUIRED'));
      assert.equal(await prisma.externalIdentity.count({ where: { identityId: workspace.identity.id } }), 0);

    });
    await t.test('adding a Google method audits the change, invalidates pending contact proof and revokes other login families', async () => {
      const a = await actor(email('security-audit'));
      await prisma.identity.update({ where: { id: a.identity.id }, data: { emailVerifiedAt: new Date() } });
      const other = await prisma.session.create({ data: { identityId: a.identity.id, tokenHash: tokenDigest(newOpaqueToken()), expiresAt: new Date(Date.now() + 600000) } });
      const pending = await prisma.accountContactChallenge.create({ data: { handleHash: tokenDigest(newOpaqueToken()), identityId: a.identity.id, sessionId: a.context.sessionId, securityVersion: 0, channel: 'email', destination: email('pending-contact'), expiresAt: new Date(Date.now() + 600000) } });
      const link = await proof(`security-audit-${run}`, a.identity.email!, { actor: a.context });
      await google.finish({ grant: link.grant, consent: true }, link.binding, randomUUID(), a.context);
      assert.ok((await prisma.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt);
      assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: a.context.sessionId } })).revokedAt, null);
      assert.ok((await prisma.accountContactChallenge.findUniqueOrThrow({ where: { id: pending.id } })).consumedAt);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } })).securityVersion, 1);
      const event = await prisma.identitySecurityEvent.findFirstOrThrow({ where: { identityId: a.identity.id }, include: { notifications: true } });
      assert.equal(event.action, 'LINKED'); assert.equal(event.method, 'google');
      assert.equal(event.notifications[0]!.destination, a.identity.email); assert.equal(event.notifications[0]!.scope, namespace);
    });
    await t.test('native handoff needs the initiating app verifier, and never returns a session in its URL', async () => {
      const result = await proof(`native-${run}`, email('native'), { native: true });
      assert.equal(result.target.protocol, 'visit:'); assert.equal(result.target.host, 'auth'); assert.equal(result.target.pathname, '/google');
      assert.equal(new URLSearchParams(result.target.hash.slice(1)).get('state'), result.clientState);
      await assert.rejects(google.preview({ grant: result.grant, verifier: newOpaqueToken() }, undefined, randomUUID()), denied(401));
      const login = await google.finish({ grant: result.grant, verifier: result.verifier }, undefined, randomUUID()); ids.add(login.identityId);
      assert.ok('sessionToken' in login); assert.equal(result.target.toString().includes('sessionToken'), false);
    });
    await t.test('cross-account links and stale/revoked authentication are rejected without consuming valid consent', async () => {
      const a = await actor(null), b = await actor(null);
      const result = await proof(`link-cross-${run}`, email('cross'), { actor: a.context });
      await assert.rejects(google.finish({ grant: result.grant, consent: true }, result.binding, randomUUID(), b.context), denied(403, 'LINK_ACCOUNT_MISMATCH'));
      await google.finish({ grant: result.grant, consent: true }, result.binding, randomUUID(), a.context);
      const old = await actor(null, 'USER', 300001);
      await assert.rejects(google.begin({ platform: 'web', intent: 'link', consent: true }, randomUUID(), old.context), denied(401, 'REAUTH_REQUIRED'));
      const revoked = await actor(null); await prisma.session.updateMany({ where: { identityId: revoked.identity.id }, data: { revokedAt: new Date() } });
      await assert.rejects(google.begin({ platform: 'web', intent: 'link', consent: true }, randomUUID(), revoked.context), denied(401));
      const laterRevoked = await actor(null);
      const waiting = await proof(`later-revoked-${run}`, email('later-revoked'), { actor: laterRevoked.context });
      await prisma.session.updateMany({ where: { identityId: laterRevoked.identity.id }, data: { revokedAt: new Date() } });
      await assert.rejects(google.finish({ grant: waiting.grant, consent: true }, waiting.binding, randomUUID(), laterRevoked.context), denied(401));
      assert.equal(await prisma.externalIdentity.count({ where: { identityId: laterRevoked.identity.id } }), 0);
      const otherAddress = await proof(`other-address-${run}`, email('existing', 'gmail.com'), { actor: b.context });
      await assert.rejects(google.finish({ grant: otherAddress.grant, consent: true }, otherAddress.binding, randomUUID(), b.context), denied(409));
    });
    await t.test('concurrent linking cannot move the same Google subject between accounts', async () => {
      const a = await actor(null), b = await actor(null);
      const first = await proof(`race-${run}`, email('race'), { actor: a.context }), second = await proof(`race-${run}`, email('race'), { actor: b.context });
      const results = await Promise.allSettled([google.finish({ grant: first.grant, consent: true }, first.binding, randomUUID(), a.context), google.finish({ grant: second.grant, consent: true }, second.binding, randomUUID(), b.context)]);
      assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal(await prisma.externalIdentity.count({ where: { provider: 'google', subject: `race-${run}` } }), 1);
    });
    await t.test('cancellation, claim errors, expired state/grants and exchange failure create no sessions', async () => {
      const before = await prisma.session.count({ where: { identityId: { in: [...ids] } } });
      const start = await google.begin({ platform: 'web', intent: 'login' }, randomUUID());
      const state = new URL(start.authorizationUrl).searchParams.get('state')!; const prior = exchanges;
      assert.equal(new URLSearchParams(new URL(await google.callback({ state, error: 'access_denied' }, start.binding!, randomUUID())).hash.slice(1)).get('status'), 'cancelled'); assert.equal(exchanges, prior);
      await assert.rejects(google.callback({ state, error: 'access_denied' }, start.binding!, randomUUID()), denied(401));
      for (const bad of [{ aud: 'wrong' }, { iss: 'evil' }, { nonce: 'wrong' }, { exp: 1 }, { email_verified: false }]) {
        const result = await proof(`bad-${randomUUID()}`, email('bad'), { bad }); assert.equal(result.grant, null); assert.equal(new URLSearchParams(result.target.hash.slice(1)).get('status'), 'failed');
      }
      const failed = await google.begin({ platform: 'web', intent: 'login' }, randomUUID());
      const failedTarget = await google.callback({ state: new URL(failed.authorizationUrl).searchParams.get('state')!, code: 'invalid-provider-code' }, failed.binding!, randomUUID());
      assert.equal(new URLSearchParams(new URL(failedTarget).hash.slice(1)).get('status'), 'failed');
      const expired = await google.begin({ platform: 'web', intent: 'login' }, randomUUID()); clockOffset = 600001;
      await assert.rejects(google.callback({ state: new URL(expired.authorizationUrl).searchParams.get('state')!, code: 'anything' }, expired.binding!, randomUUID()), denied(401)); clockOffset = 0;
      const receipt = await proof(`expire-${run}`, email('expire')); clockOffset = 120001;
      await assert.rejects(google.finish({ grant: receipt.grant }, receipt.binding, randomUUID()), denied(401)); clockOffset = 0;
      assert.equal(await prisma.session.count({ where: { identityId: { in: [...ids] } } }), before);
    });
    await t.test('Google starts have an atomic per-IP quota and cannot be activated by legacy configuration', async () => {
      for (let i = 0; i < 15; i++) await google.begin({ platform: 'web', intent: 'login' }, 'quota-ip');
      await assert.rejects(google.begin({ platform: 'web', intent: 'login' }, 'quota-ip'), denied(429));
      const disabled = createGoogleAuthService({}); assert.equal(disabled.enabled, false);
      await assert.rejects(disabled.begin({ platform: 'web', intent: 'login' }, randomUUID()), denied(503, 'GOOGLE_NOT_CONFIGURED'));
    });
    await t.test('HTTP never accepts raw ID tokens or redirect overrides, returns cookie-only web sessions, and fails closed on Redis outage', async () => {
      const headers = { origin: config.webOrigin };
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/google', headers, payload: { idToken: 'legacy-token' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/google/start', headers, payload: { platform: 'web', intent: 'login', redirectUri: 'https://attacker.test' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/google/start', headers: { origin: 'https://attacker.test' }, payload: { platform: 'web', intent: 'login' } })).statusCode, 403);
      const start = await app.inject({ method: 'POST', url: '/api/auth/google/start', headers, payload: { platform: 'web', intent: 'login' } }); assert.equal(start.statusCode, 200, start.body); assert.equal('binding' in start.json(), false);
      assert.ok(String(start.headers['set-cookie']).includes('HttpOnly'));
      const query = new URL(start.json().authorizationUrl).searchParams, code = randomUUID(); responses.set(code, claims(query.get('nonce')!, { sub: `http-${run}`, email: email('http') }));
      const cookie = String(start.headers['set-cookie']).split(';')[0]!;
      const callback = await app.inject({ url: `/api/auth/google/callback?state=${query.get('state')}&code=${code}`, headers: { cookie } }); assert.equal(callback.statusCode, 302); assert.equal(callback.headers['referrer-policy'], 'no-referrer');
      const grant = new URLSearchParams(new URL(String(callback.headers.location)).hash.slice(1)).get('grant')!;
      const complete = await app.inject({ method: 'POST', url: '/api/auth/google', headers: { ...headers, cookie }, payload: { grant } }); assert.equal(complete.statusCode, 200, complete.body); ids.add(complete.json().identity.id);
      assert.equal('sessionToken' in complete.json(), false); assert.ok(String(complete.headers['set-cookie']).includes('visit_session=')); assert.ok(String(complete.headers['set-cookie']).includes('visit_google_binding=;'));
      const offline = createGoogleAuthService({ config, provider: { exchange: async () => ({}) }, ready: async () => { throw new Error('private redis detail'); } });
      await assert.rejects(offline.begin({ platform: 'web', intent: 'login' }, randomUUID()), denied(503));
    });
  } finally {
    clockOffset = 0;
    const generated = await prisma.identity.findMany({ where: { email: { contains: run } }, select: { id: true } }); generated.forEach(identity => ids.add(identity.id));
    await prisma.identity.deleteMany({ where: { id: { in: [...ids] } } });
    let cursor = '0'; do { const scanned = await redis.scan(cursor, 'MATCH', `${namespace}:*`, 'COUNT', 100); cursor = scanned[0]; if (scanned[1].length) await redis.del(...scanned[1]); } while (cursor !== '0');
    await app.close(); await prisma.$disconnect(); redis.disconnect();
  }
});

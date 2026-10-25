import { createEmailLoginService, createLocalEmailDelivery } from '../src/security/email-login.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { AppError } from '../src/http/errors.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from '../src/security/sessions.js';
import { redis } from '../src/infra/redis.js';
const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

after(async () => {
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
});

test('passwordless email authentication is single use and keeps session tokens out of JSON for web', async () => {
  const email = `auth-${randomUUID()}@example.test`;
  const app = Fastify({ trustProxy: true });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  const emailLogin = createEmailLoginService({ delivery: createLocalEmailDelivery(), namespace: `test:auth:${randomUUID()}` });
  await registerAuthRoutes(app, { emailLogin });

  try {
    const requested = await app.inject({ method: 'POST', url: '/v1/auth/email-challenges', headers: { 'x-forwarded-for': testIp }, payload: { email } });
    assert.equal(requested.statusCode, 202, requested.body);
    assert.equal(requested.json().accepted, true);
    assert.equal(requested.body.includes('token'), false);

    // Obtain the delivered proof through the injected local transport. The HTTP
    // development mailbox intentionally stays closed under NODE_ENV=test.
    const { token } = await emailLogin.localMessage(email);

    const verified = await app.inject({ method: 'POST', url: '/v1/auth/email-challenges/verify', headers: { 'x-forwarded-for': testIp }, payload: { token } });
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().sessionToken, undefined);
    const cookie = verified.headers['set-cookie'];
    assert.equal(typeof cookie, 'string');
    assert.match(String(cookie), /HttpOnly/);

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: String(cookie).split(';')[0] } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().identity.email, email.toLowerCase());

    const replay = await app.inject({ method: 'POST', url: '/v1/auth/email-challenges/verify', headers: { 'x-forwarded-for': testIp }, payload: { token } });
    assert.equal(replay.statusCode, 401);

    await prisma.emailChallenge.deleteMany({ where: { email } });
    await prisma.identity.deleteMany({ where: { email } });
  } finally {
    await prisma.emailChallenge.deleteMany({ where: { email } });
    await prisma.identity.deleteMany({ where: { email } });
    await app.close();
  }
});

test('email challenge responses are enumeration resistant and validate addresses', async () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  await registerAuthRoutes(app);
  try {
    const invalid = await app.inject({ method: 'POST', url: '/v1/auth/email-challenges', payload: { email: 'not-an-email' } });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('session refresh rotates credentials, expires stale sessions, detects replay, and logout revokes access', async () => {
  const email = `session-${randomUUID()}@example.test`;
  const identity = await prisma.identity.create({ data: { email, emailVerifiedAt: new Date() } });
  const makeSession = async (expiresAt = sessionExpiry()) => {
    const token = newOpaqueToken();
    const row = await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt, refreshExpiresAt: expiresAt } });
    return { token, row };
  };
  const expired = await makeSession(new Date(Date.now() - 1000));
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  await registerAuthRoutes(app);

  try {
    const expiredRefresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: `visit_session=${expired.token}` } });
    assert.equal(expiredRefresh.statusCode, 401);
    const expiredMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: `visit_session=${expired.token}` } });
    assert.equal(expiredMe.statusCode, 401);

    const original = await makeSession();
    const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: `visit_session=${original.token}` } });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.equal(refreshed.json().sessionToken, undefined);
    const replacementCookie = String(refreshed.headers['set-cookie']).split(';', 1)[0]!;
    assert.match(replacementCookie, /^visit_session=/);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: original.row.id } })).revokedAt === null, false);
    const replacementMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: replacementCookie } });
    assert.equal(replacementMe.statusCode, 200);

    const replay = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: `visit_session=${original.token}` } });
    assert.equal(replay.statusCode, 401);
    const replayedSession = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: replacementCookie } });
    assert.equal(replayedSession.statusCode, 401, 'replaying a rotated token revokes the active session family');

    const logoutSession = await makeSession();
    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie: `visit_session=${logoutSession.token}` } });
    assert.equal(logout.statusCode, 200);
    assert.equal(logout.json().loggedOut, true);
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    const afterLogout = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: `visit_session=${logoutSession.token}` } });
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    await app.close();
    await prisma.identity.delete({ where: { id: identity.id } });
  }
});

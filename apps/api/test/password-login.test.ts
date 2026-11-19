import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { createPasswordLoginService, hashPassword, passwordMatches, SIGN_IN_LIMITS } from '../src/security/password-login.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { createEmailLoginService, createLocalEmailDelivery } from '../src/security/email-login.js';
import { tokenDigest } from '../src/security/sessions.js';

const emails: string[] = [], namespaces: string[] = [];
const email = () => { const value = `password-${randomUUID()}@example.test`; emails.push(value); return value; };
const password = 'correct horse battery';
const denied = (status: number, code?: string) => (error: unknown) => error instanceof AppError && error.statusCode === status && (!code || error.code === code);
// An account as MVP sign-up left it: trusted email, password, the address recorded as unproven.
async function mvpAccount(address: string, displayName = 'Dana') {
  const identity = await prisma.identity.create({ data: { email: address, emailVerifiedAt: new Date(), displayName, passwordCredential: { create: { hash: await hashPassword(password), unprovenEmail: address } } } });
  return { identity };
}
function fixture() {
  const namespace = `visit:password:test:${randomUUID()}`; namespaces.push(namespace);
  return createPasswordLoginService({ namespace });
}
after(async () => {
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

test('sign-in issues a session only for the right password, with one error for every failure', async () => {
  const service = fixture(), address = email(), ip = randomUUID();
  const { identity } = await mvpAccount(address);
  const signedIn = await service.signIn({ email: address.toUpperCase(), password }, ip);
  assert.equal(signedIn.identity.id, identity.id);
  assert.equal(await prisma.session.count({ where: { identityId: identity.id } }), 1);
  const linkOnly = email(); await prisma.identity.create({ data: { email: linkOnly, emailVerifiedAt: new Date() } });
  for (const attempt of [{ email: address, password: `${password}!` }, { email: email(), password }, { email: linkOnly, password }, { email: 'not-an-email', password }, { email: address, password: 'short' }]) {
    await assert.rejects(service.signIn(attempt, ip), denied(401, 'INVALID_CREDENTIALS'));
  }
  assert.equal(await prisma.session.count({ where: { identityId: identity.id } }), 1);
});

test('failed passwords throttle that address from that IP, while correct sign-ins never count', async () => {
  const service = fixture(), address = email(), attacker = randomUUID(), owner = randomUUID();
  await mvpAccount(address);
  for (let attempt = 0; attempt < SIGN_IN_LIMITS.addressFromIp.maximum + 2; attempt++) await service.signIn({ email: address, password }, owner);
  for (let attempt = 0; attempt < SIGN_IN_LIMITS.addressFromIp.maximum; attempt++) await assert.rejects(service.signIn({ email: address, password: `${password}!` }, attacker), denied(401));
  await assert.rejects(service.signIn({ email: address, password }, attacker), denied(429, 'RATE_LIMITED'));
  // Someone else guessing the address from another IP does not lock its owner out.
  assert.ok((await service.signIn({ email: address, password }, owner)).token);
});

test('the real owner proving the address by email link ends the password set by whoever registered it first', async () => {
  const service = fixture(), address = email();
  await mvpAccount(address, 'Squatter');
  const squatter = await service.signIn({ email: address, password }, randomUUID());
  const links = createEmailLoginService({ delivery: createLocalEmailDelivery(), namespace: `visit:email:test:${randomUUID()}` });
  await links.send(address, randomUUID());
  const owner = await links.verify((await links.localMessage(address)).token, randomUUID());
  assert.equal(owner.identity.id, squatter.identity.id);
  assert.equal(await prisma.passwordCredential.count({ where: { identityId: owner.identity.id } }), 0);
  assert.equal(await prisma.session.count({ where: { identityId: owner.identity.id, revokedAt: null } }), 1);
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { tokenHash: tokenDigest(squatter.token) } })).revokedAt instanceof Date, true);
  await assert.rejects(service.signIn({ email: address, password }, randomUUID()), denied(401, 'INVALID_CREDENTIALS'));
});

test('Redis failure refuses sign-in instead of skipping the limits', async () => {
  const service = createPasswordLoginService({ namespace: `visit:password:test:${randomUUID()}`, ready: async () => { throw new Error('redis down'); } });
  await assert.rejects(service.signIn({ email: email(), password }, randomUUID()), denied(503, 'AUTH_TEMPORARILY_UNAVAILABLE'));
});

test('/v1/me returns the account name and whether each managed business is published', async () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ code: error instanceof AppError ? error.code : 'generic' }));
  await registerAuthRoutes(app, { passwordLogin: fixture() });
  const slug = `me-${randomUUID()}`, publishedAt = new Date();
  try {
    const address = email(); await mvpAccount(address);
    const signedIn = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-in', payload: { email: address, password } });
    const cookie = signedIn.cookies.find(item => item.name.endsWith('visit_session'))!;
    const business = await prisma.business.create({ data: { name: 'Me fixture', slug, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt } });
    await prisma.membership.create({ data: { identityId: signedIn.json().identity.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().identity.displayName, 'Dana');
    assert.equal(me.json().memberships[0].business.publishedAt, publishedAt.toISOString());
    assert.equal(JSON.stringify(me.json()).includes(password), false);
  } finally { await prisma.business.deleteMany({ where: { slug } }); await app.close(); }
});

test('the sign-in route issues the session cookie and one error for a wrong password', async () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ code: error instanceof AppError ? error.code : 'generic' }));
  await registerAuthRoutes(app, { passwordLogin: fixture() });
  try {
    const address = email(); await mvpAccount(address);
    const signIn = await app.inject({ method: 'POST', url: '/v1/auth/password/sign-in', payload: { email: address, password } });
    assert.equal(signIn.statusCode, 200); assert.equal(signIn.json().identity.email, address);
    assert.ok(signIn.cookies.some(cookie => cookie.name.endsWith('visit_session'))); assert.equal(JSON.stringify(signIn.json()).includes(password), false);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/password/sign-in', payload: { email: address, password: 'wrong password' } })).json().code, 'INVALID_CREDENTIALS');
  } finally { await app.close(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { AppError } from '../src/http/errors.js';
import { tokenDigest, newOpaqueToken } from '../src/security/sessions.js';
import { registerAccountMethods } from '../src/routes/account-methods.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { registerRequestSecurity } from '../src/security/request-security.js';
import { customerContactReadiness } from '../src/security/customer-contact.utils.js';

const ORIGIN = 'https://app.example.test';
const ISRAELI_MOBILE = '+972501234567';

test('the profile contact phone is the owner\'s own, unverified and separate from the sign-in phone', async t => {
  const app = Fastify(); registerRequestSecurity(app, ORIGIN);
  await registerAccountMethods(app); await registerAuthRoutes(app);
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'VALIDATION_ERROR' } }));
  const ids: string[] = [];
  async function person() {
    const identity = await prisma.identity.create({ data: { email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date() } }); ids.push(identity.id);
    const raw = newOpaqueToken();
    await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(raw), expiresAt: new Date(Date.now() + 3600000) } });
    return { identity, headers: { authorization: `Bearer ${raw}`, origin: ORIGIN } };
  }
  const save = (headers: Record<string, string>, payload: unknown) => app.inject({ method: 'PUT', url: '/api/account/contact-phone', headers, payload: payload as object });
  const stored = (id: string) => prisma.identity.findUniqueOrThrow({ where: { id }, select: { contactPhone: true, phone: true, phoneVerifiedAt: true } });
  try {
    await t.test('saves, shows on /v1/me and clears', async () => {
      const a = await person();
      const saved = await save(a.headers, { contactPhone: ISRAELI_MOBILE });
      assert.equal(saved.statusCode, 200); assert.deepEqual(saved.json(), { contactPhone: ISRAELI_MOBILE });
      const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: a.headers.authorization } });
      assert.equal(me.json().identity.contactPhone, ISRAELI_MOBILE);
      assert.deepEqual(await stored(a.identity.id), { contactPhone: ISRAELI_MOBILE, phone: null, phoneVerifiedAt: null });
      assert.deepEqual((await save(a.headers, { contactPhone: null })).json(), { contactPhone: null });
      assert.equal((await stored(a.identity.id)).contactPhone, null);
    });
    await t.test('is not unique, so typing someone else\'s number blocks nobody', async () => {
      const a = await person(), b = await person();
      assert.equal((await save(a.headers, { contactPhone: ISRAELI_MOBILE })).statusCode, 200);
      assert.equal((await save(b.headers, { contactPhone: ISRAELI_MOBILE })).statusCode, 200);
    });
    await t.test('refuses anything but E.164 or null, and any other field', async () => {
      const a = await person();
      for (const payload of [{ contactPhone: '0501234567' }, { contactPhone: '+0501234567' }, { contactPhone: '' }, {}, { contactPhone: ISRAELI_MOBILE, phone: ISRAELI_MOBILE }, { contactPhone: ISRAELI_MOBILE, phoneVerifiedAt: new Date().toISOString() }]) {
        assert.equal((await save(a.headers, payload)).statusCode, 400, JSON.stringify(payload));
      }
      assert.deepEqual(await stored(a.identity.id), { contactPhone: null, phone: null, phoneVerifiedAt: null });
    });
    await t.test('needs a session and the app\'s origin', async () => {
      const a = await person();
      assert.equal((await save({ origin: ORIGIN }, { contactPhone: ISRAELI_MOBILE })).statusCode, 401);
      assert.equal((await save({ ...a.headers, origin: 'https://evil.example.test' }, { contactPhone: ISRAELI_MOBILE })).statusCode, 403);
      assert.equal((await stored(a.identity.id)).contactPhone, null);
    });
    await t.test('a stored contact phone never satisfies a verified-phone booking requirement', async () => {
      const a = await person();
      await save(a.headers, { contactPhone: ISRAELI_MOBILE });
      const identity = await prisma.identity.findUniqueOrThrow({ where: { id: a.identity.id } });
      const readiness = customerContactReadiness({ requireCustomerName: false, requireVerifiedPhone: true, requireVerifiedEmail: false }, identity);
      assert.deepEqual(readiness.missing, ['phone']);
    });
    await t.test('the database refuses a number that is not E.164', async () => {
      const a = await person();
      await assert.rejects(prisma.identity.update({ where: { id: a.identity.id }, data: { contactPhone: '050-1234567' } }));
    });
  } finally {
    await prisma.session.deleteMany({ where: { identityId: { in: ids } } });
    await prisma.identity.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  }
});

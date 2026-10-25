import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { registerSavedProviders } from '../src/routes/saved-providers.js';
import { registerRequestSecurity } from '../src/security/request-security.js';
import { AppError } from '../src/http/errors.js';
import { newOpaqueToken, tokenDigest } from '../src/security/sessions.js';
after(() => prisma.$disconnect());
test('provider links and saved lists are public-read-only, identity-owned and publication-safe', async t => {
  const run = randomUUID(), people: string[] = [], businesses: string[] = [];
  const app = Fastify(); registerRequestSecurity(app, 'https://visit.test');
  app.setErrorHandler((error, _req, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: error instanceof AppError ? error.code : 'INVALID' }));
  await registerSavedProviders(app);
  async function person() { const p = await prisma.identity.create({ data: { email: `saved-${randomUUID()}@example.test` } }); people.push(p.id); const token = newOpaqueToken(); await prisma.session.create({ data: { identityId: p.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } }); return { id: p.id, token, headers: { authorization: `Bearer ${token}`, 'x-visit-client': 'native' } }; }
  async function business(published = true) { const b = await prisma.business.create({ data: { name: 'Public studio', slug: `saved-${randomUUID()}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: published ? new Date() : null } }); businesses.push(b.id); return b; }
  const a = await person(), b = await person(), target = await business(), draft = await business(false);
  const add = (headers: Record<string, string> = a.headers, payload: object = { slug: target.slug }) => app.inject({ method: 'POST', url: '/api/me/providers', headers, payload });
  try {
    await t.test('anonymous/authenticated GET previews never save; only published exact canonical links resolve', async () => {
      for (const headers of [{}, a.headers]) { const result = await app.inject({ url: `/api/provider-links/${target.slug}`, headers }); assert.equal(result.statusCode, 200); assert.equal(result.json().path, `/p/${target.slug}`); assert.equal('memberships' in result.json().provider, false); }
      assert.equal(await prisma.savedProvider.count({ where: { businessId: target.id } }), 0);
      assert.equal((await app.inject({ url: `/api/provider-links/${draft.slug}` })).statusCode, 404);
      for (const path of ['bad%2Fpath', 'bad%5Cpath', '%2e%2e', 'missing', `${target.slug.toUpperCase()}`]) assert.equal((await app.inject({ url: `/api/provider-links/${path}` })).statusCode, 404);
      assert.equal((await app.inject({ url: '/api/providers' })).statusCode, 404);
    });
    await t.test('authentication, CSRF, strict selectors and expected-identity checks prevent cross-account saves', async () => {
      assert.equal((await add({ authorization: '', 'x-visit-client': 'native' })).statusCode, 401);
      assert.equal((await add(a.headers, { slug: target.slug, identityId: b.id })).statusCode, 400);
      assert.equal((await add(a.headers, { businessId: draft.id })).statusCode, 404);
      assert.equal((await add({ ...a.headers, 'x-visit-expected-identity': b.id })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: '/api/me/providers', headers: { cookie: `visit_session=${a.token}`, origin: 'https://evil.test' }, payload: { slug: target.slug } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/me/providers', headers: { cookie: `visit_session=${a.token}` }, payload: { slug: target.slug } })).statusCode, 403);
      assert.equal(await prisma.savedProvider.count({ where: { identityId: a.id } }), 0);
    });
    await t.test('parallel repeated scans are idempotent and create no memberships, bookings or notifications', async () => {
      const results = await Promise.all([add(), add()]); assert.deepEqual(results.map(r => r.statusCode), [200, 200]);
      assert.equal(results[0].json().saved.id, results[1].json().saved.id);
      assert.equal(await prisma.savedProvider.count({ where: { identityId: a.id, businessId: target.id } }), 1);
      assert.equal(await prisma.membership.count({ where: { identityId: a.id } }), 0); assert.equal(await prisma.booking.count({ where: { customerId: a.id } }), 0);
      assert.deepEqual((await app.inject({ url: '/api/me/providers', headers: b.headers })).json().providers, []);
      assert.equal((await app.inject({ url: '/api/me/providers', headers: a.headers })).json().providers[0].provider.name, 'Public studio');
      assert.equal((await app.inject({ url: `/api/me/providers?identityId=${a.id}`, headers: b.headers })).statusCode, 400);
    });
    await t.test('unpublish/deletion retains unavailable saved name without leaking later draft metadata', async () => {
      await prisma.business.update({ where: { id: target.id }, data: { publishedAt: null, name: 'Private draft name', location: 'Private draft location' } });
      const row = (await app.inject({ url: '/api/me/providers', headers: a.headers })).json().providers[0];
      assert.equal(row.available, false); assert.deepEqual(row.provider, { id: target.id, name: 'Public studio' });
      assert.equal((await add()).statusCode, 404);
      await prisma.business.update({ where: { id: target.id }, data: { publishedAt: new Date(), deletedAt: new Date() } });
      assert.equal((await app.inject({ url: `/api/provider-links/${target.slug}` })).statusCode, 404);
      assert.equal((await app.inject({ url: '/api/me/providers', headers: a.headers })).json().providers[0].available, false);
      await assert.rejects(prisma.business.delete({ where: { id: target.id } })); // Required reference preserves unavailable state.
      await prisma.business.update({ where: { id: target.id }, data: { publishedAt: new Date(), deletedAt: null, name: 'Public studio' } });
    });
    await t.test('remove is scoped/idempotent and preserves other accounts and customer identity', async () => {
      assert.equal((await add(b.headers)).statusCode, 200);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/me/providers/${target.id}`, headers: { ...b.headers, 'x-visit-expected-identity': a.id } })).statusCode, 409);
      assert.equal(await prisma.savedProvider.count({ where: { identityId: b.id, businessId: target.id } }), 1);
      const staff = await prisma.staff.create({ data: { businessId: target.id, displayName: 'Saved-provider fixture' } });
      const service = await prisma.service.create({ data: { businessId: target.id, name: 'Existing appointment', durationMinutes: 30 } });
      const startsAt = new Date(Date.now() + 86400000), endsAt = new Date(startsAt.getTime() + 1800000);
      const booking = await prisma.booking.create({ data: { businessId: target.id, customerId: a.id, staffId: staff.id, serviceId: service.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', idempotencyKey: randomUUID() } });
      const remove = () => app.inject({ method: 'DELETE', url: `/api/me/providers/${target.id}`, headers: a.headers });
      assert.equal((await remove()).statusCode, 200); assert.equal((await remove()).statusCode, 200);
      assert.equal(await prisma.savedProvider.count({ where: { identityId: a.id, businessId: target.id } }), 0);
      assert.equal(await prisma.savedProvider.count({ where: { identityId: b.id, businessId: target.id } }), 1);
      assert.ok(await prisma.identity.findUnique({ where: { id: a.id } }));
      assert.deepEqual(await prisma.booking.findUnique({ where: { id: booking.id } }), booking);
    });
    await t.test('unpublish racing a save cannot persist a draft and revoked sessions cannot activate', async () => {
      let locked!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { locked = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      const unpublish = prisma.$transaction(async tx => { await tx.business.update({ where: { id: target.id }, data: { publishedAt: null } }); locked(); await wait; });
      await ready;
      const pending = add().then(value => value);
      await new Promise(resolve => setTimeout(resolve, 30)); release(); await unpublish;
      assert.equal((await pending).statusCode, 404);
      assert.equal(await prisma.savedProvider.count({ where: { identityId: a.id, businessId: target.id } }), 0);
      await prisma.session.updateMany({ where: { identityId: a.id }, data: { revokedAt: new Date() } });
      assert.equal((await add()).statusCode, 401);
    });
    await t.test('owned pagination is deterministic and foreign/invalid cursors never disclose records', async () => {
      const rows = await Promise.all(Array.from({ length: 52 }, () => business()));
      await prisma.savedProvider.createMany({ data: rows.map(row => ({ identityId: b.id, businessId: row.id, displayName: row.name })) });
      const first = (await app.inject({ url: '/api/me/providers', headers: b.headers })).json(); assert.equal(first.providers.length, 50); assert.ok(first.nextCursor);
      const second = (await app.inject({ url: `/api/me/providers?cursor=${first.nextCursor}`, headers: b.headers })).json(); assert.equal(second.providers.length, 3); assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.providers, ...second.providers].map((row: { id: string }) => row.id)).size, 53);
      const outsider = await person(); assert.equal((await app.inject({ url: `/api/me/providers?cursor=${first.nextCursor}`, headers: outsider.headers })).statusCode, 400);
    });
  } finally { await app.close(); await prisma.savedProvider.deleteMany({ where: { identityId: { in: people } } }); await prisma.booking.deleteMany({ where: { businessId: { in: businesses }, customerId: { in: people } } }); await prisma.business.deleteMany({ where: { id: { in: businesses } } }); await prisma.identity.deleteMany({ where: { id: { in: people } } }); }
});

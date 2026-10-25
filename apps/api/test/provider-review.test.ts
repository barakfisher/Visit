import { promoteAdministrator } from '../src/security/admin-role.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { AppError } from '../src/http/errors.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from '../src/security/sessions.js';
import { createReviewDelivery, createReviewNotificationWorker } from '../src/security/provider-review-notifications.js';
after(() => prisma.$disconnect());
test('new business review is authorized, atomic, reasoned, idempotent and independently notified', async t => {
  const suffix = randomUUID(), scope = `test:review:${suffix}`, ids: string[] = [], businesses: string[] = [];
  const app = Fastify(); app.setErrorHandler((error, _req, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ error: error instanceof AppError ? error.code : 'INTERNAL' }));
  await registerProviderRoutes(app, { reviewScope: scope });
  async function person(admin = false, phoneOnly = false) {
    const person = await prisma.identity.create({ data: { ...(phoneOnly ? {} : { email: `review-${randomUUID()}@example.test`, emailVerifiedAt: new Date() }), platformRole: admin ? 'ADMIN' : 'USER' } }); ids.push(person.id);
    const token = newOpaqueToken(); await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: sessionExpiry() } });
    return { id: person.id, cookie: `visit_session=${token}` };
  }
  const applicant = await person(), admin = await person(true), outsider = await person(), phoneOnly = await person(false, true);
  async function apply(cookie = applicant.cookie) {
    const slug = `review-${randomUUID()}`;
    const r = await app.inject({ method: 'POST', url: '/v1/provider-applications', headers: { cookie }, payload: { businessName: 'Review clinic', slug } }); assert.equal(r.statusCode, 201, r.body);
    const business = await prisma.business.findUniqueOrThrow({ where: { slug } }); businesses.push(business.id);
    return { id: r.json().id as string, businessId: business.id };
  }
  const decide = (id: string, decision = 'APPROVED', reason = 'Reviewed the new business ownership evidence.', cookie = admin.cookie) => app.inject({ method: 'POST', url: `/v1/admin/provider-applications/${id}/decision`, headers: { cookie }, payload: { decision, reason } });
  try {
    await t.test('no arbitrary business joining, no customer/admin cross-access or missing reasons', async () => {
      const item = await apply();
      assert.equal((await app.inject({ method: 'POST', url: '/v1/provider-applications', headers: { cookie: outsider.cookie }, payload: { businessId: item.businessId } })).statusCode, 400);
      assert.equal((await decide(item.id, 'APPROVED', 'Valid reason', outsider.cookie)).statusCode, 403);
      assert.equal((await decide(item.id, 'APPROVED', '')).statusCode, 400);
      assert.equal((await decide('does-not-exist')).statusCode, 404);
      assert.equal((await app.inject({ url: '/v1/admin/provider-applications', headers: { cookie: outsider.cookie } })).statusCode, 403);
      const own = await app.inject({ url: '/v1/provider-applications', headers: { cookie: outsider.cookie } }); assert.deepEqual(own.json().applications, []);
      assert.equal((await prisma.providerApplication.findUniqueOrThrow({ where: { id: item.id } })).status, 'PENDING');
    });
    await t.test('parallel opposing reviews commit one actor/time/reason/event and only intended membership', async () => {
      const item = await apply();
      const results = await Promise.all([decide(item.id), decide(item.id, 'REJECTED')]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
      const reviewed = await prisma.providerApplication.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(reviewed.reviewedById, admin.id); assert.ok(reviewed.reviewedAt); assert.ok(reviewed.reviewReason);
      assert.equal((await decide(item.id, reviewed.status, reviewed.reviewReason!)).statusCode, 200);
      assert.equal(await prisma.providerReviewNotification.count({ where: { applicationId: item.id } }), 1);
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: item.businessId, identityId: applicant.id } });
      assert.equal(membership.status, reviewed.status === 'APPROVED' ? 'ACTIVE' : 'REVOKED');
      assert.equal(await prisma.membership.count({ where: { businessId: item.businessId, identityId: outsider.id } }), 0);
      assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: item.businessId } })).publishedAt, null);
    });
    await t.test('review refuses legacy ownership claims and revoked target membership without partial changes', async () => {
      const item = await apply(); await prisma.providerApplication.update({ where: { id: item.id }, data: { kind: 'LEGACY' } });
      assert.equal((await decide(item.id)).statusCode, 409);
      await prisma.providerApplication.update({ where: { id: item.id }, data: { kind: 'NEW_BUSINESS' } });
      await prisma.membership.updateMany({ where: { businessId: item.businessId }, data: { status: 'REVOKED' } });
      assert.equal((await decide(item.id)).statusCode, 409);
      assert.equal((await prisma.providerApplication.findUniqueOrThrow({ where: { id: item.id } })).status, 'PENDING');
      assert.equal(await prisma.providerReviewNotification.count({ where: { applicationId: item.id } }), 0);
    });
    await t.test('notification failure/retry never undoes approval; phone-only users retain in-app reason', async () => {
      const item = await apply(); assert.equal((await decide(item.id)).statusCode, 200);
      const fallback = await apply(phoneOnly.cookie); assert.equal((await decide(fallback.id, 'REJECTED', 'Please provide verified business ownership evidence.')).statusCode, 200);
      const worker = createReviewNotificationWorker({ available: true, send: async () => { throw new Error('provider unavailable'); } }, scope);
      await worker.run(); await worker.stop();
      const failed = await prisma.providerReviewNotification.findUniqueOrThrow({ where: { applicationId: item.id } }); assert.equal(failed.status, 'QUEUED'); assert.equal(failed.attempts, 1);
      assert.equal((await prisma.providerApplication.findUniqueOrThrow({ where: { id: item.id } })).status, 'APPROVED');
      assert.equal((await prisma.providerReviewNotification.findUniqueOrThrow({ where: { applicationId: fallback.id } })).status, 'IN_APP');
      const own = (await app.inject({ url: '/v1/provider-applications', headers: { cookie: phoneOnly.cookie } })).json().applications;
      assert.match(own[0].reviewReason, /ownership/); assert.equal(own[0].notification.status, 'IN_APP');
      await prisma.providerReviewNotification.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(0) } });
      const local = createReviewNotificationWorker(createReviewDelivery({ mode: 'local-inbox' }), scope); await local.run(); await local.stop();
      assert.equal((await prisma.providerReviewNotification.findUniqueOrThrow({ where: { id: failed.id } })).status, 'LOCAL');
    });
    await t.test('stale/revoked reviewer sessions cannot commit decisions', async () => {
      const item = await apply();
      await prisma.session.updateMany({ where: { identityId: admin.id }, data: { authenticatedAt: new Date(Date.now() - 360000) } });
      assert.equal((await decide(item.id)).statusCode, 401);
      assert.equal((await prisma.providerApplication.findUniqueOrThrow({ where: { id: item.id } })).status, 'PENDING');
      await prisma.session.updateMany({ where: { identityId: admin.id }, data: { authenticatedAt: new Date() } });
    });
    await t.test('two workers lease one event; unconfigured delivery reports blocked without a send', async () => {
      await prisma.providerReviewNotification.updateMany({ where: { scope }, data: { nextAttemptAt: new Date(Date.now() + 86400000) } });
      const item = await apply(); assert.equal((await decide(item.id)).statusCode, 200);
      const blocked = createReviewNotificationWorker({ available: false, send: async () => { throw new Error('must not send'); } }, scope); await blocked.run(); await blocked.stop();
      const event = await prisma.providerReviewNotification.findUniqueOrThrow({ where: { applicationId: item.id } }); assert.equal(event.status, 'BLOCKED');
      await prisma.providerReviewNotification.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(0) } });
      let sends = 0;
      const delivery = { available: true, send: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 30)); return 'resend'; } };
      const a = createReviewNotificationWorker(delivery, scope), b = createReviewNotificationWorker(delivery, scope);
      await Promise.all([a.run(), b.run()]); await a.stop(); await b.stop();
      assert.equal(sends, 1); assert.equal((await prisma.providerReviewNotification.findUniqueOrThrow({ where: { id: event.id } })).status, 'ACCEPTED');
    });
    await t.test('operator promotion requires verified identity/evidence, audits once and revokes old sessions', async () => {
      await assert.rejects(promoteAdministrator({ identity: phoneOnly.id, operator: 'test operator', reason: 'Ownership checked in test fixture.' }), /verified identity/);
      await assert.rejects(promoteAdministrator({ identity: outsider.id, operator: '', reason: 'Ownership checked in test fixture.' }), /operator/);
      await promoteAdministrator({ identity: outsider.id, operator: 'fixture operator', reason: 'Ownership checked in test fixture.' });
      await promoteAdministrator({ identity: outsider.id, operator: 'fixture operator', reason: 'Ownership checked in test fixture.' });
      assert.equal(await prisma.adminRoleAudit.count({ where: { identityId: outsider.id } }), 1);
      assert.equal((await app.inject({ url: '/v1/admin/provider-applications', headers: { cookie: outsider.cookie } })).statusCode, 401);
    });
    await t.test('transactional adapter uses stable idempotency key and hides provider errors', async () => {
      let key: string | null = null;
      const delivery = createReviewDelivery({ mode: 'resend', key: 'synthetic-key', from: 'test@example.test', transport: async (_url, init) => { key = new Headers(init?.headers).get('Idempotency-Key'); return Response.json({ id: 'synthetic' }); } });
      assert.equal(await delivery.send({ id: 'event', to: 'synthetic@example.test', decision: 'APPROVED', reason: 'Reviewed.', locale: 'en' }), 'resend'); assert.equal(key, 'provider-review/event');
      const broken = createReviewDelivery({ mode: 'resend', key: 'synthetic-key', transport: async () => new Response('secret-provider-body', { status: 500 }) });
      await assert.rejects(broken.send({ id: 'event', to: 'synthetic@example.test', decision: 'REJECTED', reason: 'Reviewed.', locale: 'he' }), /^Error: Delivery failed$/);
    });
  } finally { await app.close(); await prisma.business.deleteMany({ where: { id: { in: businesses } } }); await prisma.adminRoleAudit.deleteMany({ where: { identityId: { in: ids } } }); await prisma.identity.deleteMany({ where: { id: { in: ids } } }); }
});

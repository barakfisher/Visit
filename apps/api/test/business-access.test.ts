import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { registerBusinessAccess } from '../src/routes/business-access.js';
import { AppError } from '../src/http/errors.js';
import { newOpaqueToken, tokenDigest, sessionExpiry } from '../src/security/sessions.js';
import { authProfile } from '../src/routes/flow-auth.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });
test('existing-business access requires scoped, verified, single-use consent and leaves publication intact', async t => {
  const ids: string[] = [], businesses: string[] = [];
  const app = Fastify(); app.setErrorHandler((error, _r, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ code: error instanceof AppError ? error.code : 'ERROR' }));
  await registerBusinessAccess(app);
  async function person(admin = false) {
    const email = `invite-${randomUUID()}@example.test`;
    const i = await prisma.identity.create({ data: { email, emailVerifiedAt: new Date(), platformRole: admin ? 'ADMIN' : 'USER' } }); ids.push(i.id);
    const token = newOpaqueToken(); await prisma.session.create({ data: { identityId: i.id, tokenHash: tokenDigest(token), expiresAt: sessionExpiry() } });
    return { ...i, cookie: `visit_session=${token}` };
  }
  const owner = await person(), manager = await person(), staff = await person(), receiver = await person(), outsider = await person(), admin = await person(true);
  for (let n = 0; n < 2; n++) { const b = await prisma.business.create({ data: { name: 'Invitation fixture', slug: `inv-${randomUUID()}`, approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } }); businesses.push(b.id); }
  const b = businesses[0]!, other = businesses[1]!;
  const ownerMember = await prisma.membership.create({ data: { businessId: b, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
  const managerMember = await prisma.membership.create({ data: { businessId: b, identityId: manager.id, role: 'MANAGER', status: 'ACTIVE' } });
  const staffMember = await prisma.membership.create({ data: { businessId: b, identityId: staff.id, role: 'STAFF', status: 'ACTIVE' } });
  const original = await prisma.business.findUniqueOrThrow({ where: { id: b } });
  const req = (method: 'GET' | 'POST' | 'DELETE', url: string, who = owner, payload?: object) => app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const invite = async (who = owner, role = 'STAFF', recipient = receiver.email!) => { const r = await req('POST', `/v1/provider/businesses/${b}/invitations`, who, { role, channel: 'email', recipient }); assert.equal(r.statusCode, 200, r.body); const v = r.json(); return { ...v, token: new URL(v.url).hash.slice('#invite='.length) }; };
  const accept = (token: string, who = receiver) => req('POST', '/v1/business-invitations/accept', who, { token });
  try {
    await t.test('permission matrix, strict schema and cross-tenant identifiers', async () => {
      for (const [who, role] of [[manager, 'MANAGER'], [staff, 'STAFF'], [outsider, 'STAFF']] as const) assert.equal((await req('POST', `/v1/provider/businesses/${b}/invitations`, who, { role, channel: 'email', recipient: receiver.email })).statusCode, 403);
      assert.equal((await req('POST', `/v1/provider/businesses/${b}/invitations`, owner, { role: 'OWNER', channel: 'email', recipient: receiver.email })).statusCode, 400);
      assert.equal((await req('GET', `/v1/provider/businesses/${other}/team`)).statusCode, 403);
      assert.equal((await req('GET', `/v1/provider/businesses/${b}/team`, staff)).statusCode, 403);
      const v = await invite(); assert.equal((await req('DELETE', `/v1/provider/businesses/${other}/invitations/${v.id}`)).statusCode, 403);
      const stored = await prisma.businessInvitation.findUniqueOrThrow({ where: { id: v.id } }); assert.equal(stored.tokenHash, tokenDigest(v.token)); assert.ok(!JSON.stringify(stored).includes(v.token)); assert.ok(!JSON.stringify(stored).includes(receiver.email!));
    });
    await t.test('preview does not grant access; wrong/unverified recipients cannot accept; parallel consumption is atomic', async () => {
      const v = await invite(owner, 'MANAGER');
      assert.equal((await req('POST', '/v1/business-invitations/preview', receiver, { token: v.token })).statusCode, 200);
      assert.equal(await prisma.membership.count({ where: { businessId: b, identityId: receiver.id } }), 0);
      assert.equal((await accept(v.token, outsider)).statusCode, 403);
      await prisma.identity.update({ where: { id: receiver.id }, data: { emailVerifiedAt: null } }); assert.equal((await accept(v.token)).statusCode, 403);
      await prisma.identity.update({ where: { id: receiver.id }, data: { emailVerifiedAt: new Date() } });
      const result = await Promise.all([accept(v.token), accept(v.token)]); assert.deepEqual(result.map(x => x.statusCode).sort(), [200, 409]);
      assert.equal(await prisma.businessAccessEvent.count({ where: { referenceId: v.id } }), 1);
      assert.equal((await accept(v.token)).statusCode, 409);
    });
    await t.test('replacement, expiry, revocation and revoked inviter fail closed', async () => {
      const old = await invite(), next = await invite(); assert.equal((await accept(old.token)).statusCode, 409);
      await prisma.businessInvitation.update({ where: { id: next.id }, data: { createdAt: new Date(Date.now() - 7200000), expiresAt: new Date(Date.now() - 3600000) } }); assert.equal((await accept(next.token)).statusCode, 409);
      const revoked = await invite(); assert.equal((await req('DELETE', `/v1/provider/businesses/${b}/invitations/${revoked.id}`)).statusCode, 200); assert.equal((await accept(revoked.token)).statusCode, 409);
      const byManager = await invite(manager); await prisma.membership.update({ where: { id: managerMember.id }, data: { status: 'REVOKED' } }); assert.equal((await accept(byManager.token)).statusCode, 409); await prisma.membership.update({ where: { id: managerMember.id }, data: { status: 'ACTIVE' } });
    });
    await t.test('phone recipient binding and strongest-role context survive multiple memberships', async () => {
      await prisma.identity.update({ where: { id: receiver.id }, data: { phone: `+9725${String(Date.now()).slice(-8)}`, phoneVerifiedAt: new Date() } });
      const person = await prisma.identity.findUniqueOrThrow({ where: { id: receiver.id } });
      const r = await req('POST', `/v1/provider/businesses/${b}/invitations`, manager, { role: 'STAFF', channel: 'phone', recipient: person.phone }); assert.equal(r.statusCode, 200, r.body);
      const token = new URL(r.json().url).hash.slice(8); assert.equal((await accept(token)).statusCode, 200);
      assert.equal((await requireBusinessMembership(receiver.id, b)).role, 'MANAGER');
      const profile = await authProfile(receiver.id); assert.equal(profile.businesses.length, 1); assert.equal(profile.businesses[0]?.role, 'MANAGER');
      assert.equal((await req('DELETE', `/v1/provider/businesses/${b}/members/${staffMember.id}`, receiver)).statusCode, 200);
      assert.equal((await req('DELETE', `/v1/provider/businesses/${b}/members/${ownerMember.id}`, manager)).statusCode, 403);
    });
    await t.test('member revocation invalidates issued invitations and all subordinate roles without owner lockout', async () => {
      const v = await invite(receiver, 'STAFF', outsider.email!);
      const member = await prisma.membership.findFirstOrThrow({ where: { identityId: receiver.id, businessId: b, role: 'MANAGER' } });
      assert.equal((await req('DELETE', `/v1/provider/businesses/${b}/members/${member.id}`)).statusCode, 200);
      assert.equal((await accept(v.token, outsider)).statusCode, 409);
      assert.equal(await prisma.membership.count({ where: { businessId: b, identityId: receiver.id, status: 'ACTIVE' } }), 0);
      await assert.rejects(requireBusinessMembership(receiver.id, b));
      assert.equal((await req('DELETE', `/v1/provider/businesses/${b}/members/${ownerMember.id}`)).statusCode, 403);
    });
    await t.test('manual ownership requires recent admin, verified independent claimant, evidence and immutable decision', async () => {
      const input = { businessId: b, claimantIdentityId: outsider.id, caseReference: `case-${randomUUID()}`, evidenceKind: 'CURRENT_OWNER_CONSENT', evidenceSummary: 'Synthetic owner consent verified for this isolated test fixture.' };
      assert.equal((await req('POST', '/v1/admin/ownership-cases', owner, input)).statusCode, 403);
      assert.equal((await req('POST', '/v1/admin/ownership-cases', admin, { ...input, claimantIdentityId: admin.id })).statusCode, 403);
      const created = await req('POST', '/v1/admin/ownership-cases', admin, input); assert.equal(created.statusCode, 200, created.body);
      const id = created.json().id;
      await prisma.identity.update({ where: { id: outsider.id }, data: { securityVersion: { increment: 1 } } });
      const decide = (caseId = id, decision = 'APPROVED') => req('POST', `/v1/admin/ownership-cases/${caseId}/decision`, admin, { decision, reason: 'Evidence reviewed against original owner records.' });
      assert.equal((await decide()).statusCode, 409); assert.equal((await decide(id, 'REJECTED')).statusCode, 200);
      await assert.rejects(prisma.businessOwnershipReview.update({ where: { id }, data: { evidenceSummary: 'Changed' } }));
      const fresh = await req('POST', '/v1/admin/ownership-cases', admin, { ...input, caseReference: `case-${randomUUID()}` }); assert.equal(fresh.statusCode, 200);
      const outcomes = await Promise.all([decide(fresh.json().id), decide(fresh.json().id, 'REJECTED')]); assert.deepEqual(outcomes.map(x => x.statusCode).sort(), [200, 409]);
      const row = await prisma.businessOwnershipReview.findUniqueOrThrow({ where: { id: fresh.json().id } });
      assert.equal(row.reviewedByIdentityId, admin.id);
      assert.equal(await prisma.membership.count({ where: { businessId: b, identityId: outsider.id, role: 'OWNER', status: 'ACTIVE' } }), row.status === 'APPROVED' ? 1 : 0);
      await prisma.membership.create({ data: { businessId: b, identityId: owner.id, role: 'MANAGER', status: 'ACTIVE' } });
      const profile = await authProfile(owner.id); assert.equal(profile.businesses.length, 1); assert.equal(profile.businesses[0]?.role, 'OWNER');
      const event = await prisma.businessAccessEvent.findFirstOrThrow({ where: { businessId: b } }); await assert.rejects(prisma.businessAccessEvent.update({ where: { id: event.id }, data: { action: 'REVOKED' } }));
    });
    await t.test('revocation racing acceptance has one terminal outcome and foreign inviter parents are rejected', async () => {
      const v = await invite(owner, 'STAFF', staff.email!);
      const [accepted, revoked] = await Promise.all([accept(v.token, staff), req('DELETE', `/v1/provider/businesses/${b}/invitations/${v.id}`)]);
      assert.deepEqual([accepted.statusCode, revoked.statusCode].sort(), [200, 409]);
      const row = await prisma.businessInvitation.findUniqueOrThrow({ where: { id: v.id } });
      assert.notEqual(!!row.acceptedAt, !!row.revokedAt);
      const { id: _id, ...copy } = row;
      await assert.rejects(prisma.businessInvitation.create({ data: { ...copy, id: randomUUID(), businessId: other, tokenHash: tokenDigest(newOpaqueToken()) } }));
      await assert.rejects(prisma.businessInvitation.create({ data: { ...copy, id: randomUUID(), tokenHash: tokenDigest(newOpaqueToken()), expiresAt: new Date(copy.createdAt.getTime() + 8 * 86400000) } }));
    });
    await t.test('stale session, revoked session and unapproved business cannot create grants', async () => {
      await prisma.session.updateMany({ where: { identityId: owner.id }, data: { authenticatedAt: new Date(Date.now() - 360000) } });
      assert.equal((await req('POST', `/v1/provider/businesses/${b}/invitations`, owner, { role: 'STAFF', channel: 'email', recipient: receiver.email })).statusCode, 401);
      await prisma.session.updateMany({ where: { identityId: owner.id }, data: { authenticatedAt: new Date() } });
      const before = await prisma.business.findUniqueOrThrow({ where: { id: b } }); assert.deepEqual(before, original);
      assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: ownerMember.id } })).status, 'ACTIVE');
      await redis.set(`visit:invitation-limit:${owner.id}`, '30', 'EX', 3600);
      assert.equal((await req('POST', `/v1/provider/businesses/${b}/invitations`, owner, { role: 'STAFF', channel: 'email', recipient: receiver.email })).statusCode, 429);
      await prisma.session.updateMany({ where: { identityId: owner.id }, data: { revokedAt: new Date() } });
      assert.equal((await req('GET', `/v1/provider/businesses/${b}/team`)).statusCode, 401);
      await prisma.session.updateMany({ where: { identityId: owner.id }, data: { revokedAt: null } });
      await prisma.business.update({ where: { id: b }, data: { approvalStatus: 'REJECTED' } }); assert.equal((await req('GET', `/v1/provider/businesses/${b}/team`)).statusCode, 403);
    });
  } finally {
    await app.close();
    await prisma.businessAccessEvent.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.businessOwnershipReview.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.businessInvitation.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.membership.deleteMany({ where: { businessId: { in: businesses } } }); await prisma.business.deleteMany({ where: { id: { in: businesses } } });
    await prisma.session.deleteMany({ where: { identityId: { in: ids } } }); await prisma.identity.deleteMany({ where: { id: { in: ids } } });
    if (redis.status === 'ready') await redis.del(...ids.map(id => `visit:invitation-limit:${id}`));
  }
});

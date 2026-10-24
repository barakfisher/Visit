import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { BusinessApprovalStatus, MembershipRole, MembershipStatus, PlatformRole } from '../src/generated/prisma/client.js';
import { prisma } from '../src/db/client.js';
import { AppError } from '../src/http/errors.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from '../src/security/sessions.js';

after(async () => { await prisma.$disconnect(); });

test('providers receive no tenant access until approval; approved members remain isolated', async () => {
  const suffix = randomUUID();
  const userEmail = `provider-${suffix}@example.test`;
  const secondEmail = `other-${suffix}@example.test`;
  const slug = `visit-test-${suffix}`;
  const secondSlug = `other-test-${suffix}`;
  const user = await prisma.identity.create({ data: { email: userEmail, emailVerifiedAt: new Date() } });
  const secondIdentity = await prisma.identity.create({ data: { email: secondEmail, emailVerifiedAt: new Date() } });
  const admin = await prisma.identity.create({ data: { email: `admin-${suffix}@example.test`, emailVerifiedAt: new Date(), platformRole: PlatformRole.ADMIN } });
  const issueSession = async (identityId: string) => {
    const token = newOpaqueToken();
    await prisma.session.create({ data: { identityId, tokenHash: tokenDigest(token), expiresAt: sessionExpiry() } });
    return `visit_session=${token}`;
  };
  const userCookie = await issueSession(user.id);
  const adminCookie = await issueSession(admin.id);
  const secondCookie = await issueSession(secondIdentity.id);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  await registerProviderRoutes(app);

  let businessId: string | undefined;
  let secondBusinessId: string | undefined;
  try {
    const submitted = await app.inject({
      method: 'POST', url: '/v1/provider-applications', headers: { cookie: userCookie },
      payload: { businessName: 'Test Clinic', slug, timezone: 'Asia/Jerusalem' },
    });
    assert.equal(submitted.statusCode, 201, submitted.body);
    assert.equal(submitted.json().status, BusinessApprovalStatus.PENDING);
    businessId = (await prisma.business.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;

    const deniedBeforeApproval = await app.inject({ method: 'GET', url: `/v1/provider/businesses/${businessId}/services`, headers: { cookie: userCookie } });
    assert.equal(deniedBeforeApproval.statusCode, 403);
    const notPublicBeforeApproval = await app.inject({ method: 'GET', url: `/v1/businesses/${businessId}/services` });
    assert.equal(notPublicBeforeApproval.statusCode, 404);

    const decision = await app.inject({
      method: 'POST', url: `/v1/admin/provider-applications/${submitted.json().id}/decision`, headers: { cookie: adminCookie }, payload: { decision: 'APPROVED' },
    });
    assert.equal(decision.statusCode, 200, decision.body);
    const membership = await prisma.membership.findUniqueOrThrow({ where: { identityId_businessId_role: { identityId: user.id, businessId, role: MembershipRole.OWNER } } });
    assert.equal(membership.status, MembershipStatus.ACTIVE);

    const created = await app.inject({
      method: 'POST', url: `/v1/provider/businesses/${businessId}/services`, headers: { cookie: userCookie },
      payload: { name: 'Consultation', durationMinutes: 45 },
    });
    assert.equal(created.statusCode, 201, created.body);
    const serviceId = created.json<{ id: string }>().id;

    const foreignRead = await app.inject({ method: 'GET', url: `/v1/provider/businesses/${businessId}/services/${serviceId}`, headers: { cookie: secondCookie } });
    assert.equal(foreignRead.statusCode, 403);

    const otherBusiness = await prisma.business.create({ data: { name: 'Other Business', slug: secondSlug, timezone: 'UTC', approvalStatus: BusinessApprovalStatus.APPROVED } });
    secondBusinessId = otherBusiness.id;
    const otherService = await prisma.service.create({ data: { businessId: secondBusinessId, name: 'Other Service', durationMinutes: 30 } });
    const staff = await prisma.staff.create({ data: { businessId, displayName: 'Staff Member' } });
    await assert.rejects(
      prisma.staffService.create({ data: { businessId, staffId: staff.id, serviceId: otherService.id } }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003',
    );
  } finally {
    await app.close();
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    if (secondBusinessId) await prisma.business.deleteMany({ where: { id: secondBusinessId } });
    await prisma.identity.deleteMany({ where: { id: { in: [user.id, secondIdentity.id, admin.id] } } });
  }
});

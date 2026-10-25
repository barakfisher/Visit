import { prisma } from '../db/client.js';
import { conflict, forbidden, notFound } from '../http/errors.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { lockRecentAccountSession, requireRecentAccountAuth, lockIdentitySecurity } from '../security/account-security.js';
export async function reviewProviderApplication(actor: AuthenticatedSession, applicationId: string, decision: 'APPROVED' | 'REJECTED', reason: string, scope = 'live') {
  await requireRecentAccountAuth(actor);
  const adminId = actor.identity.id;
  return prisma.$transaction(async tx => {
    await lockRecentAccountSession(tx, actor);
    await lockIdentitySecurity(tx, adminId);
    if ((await tx.identity.findUnique({ where: { id: adminId } }))?.platformRole !== 'ADMIN') throw forbidden();
    await tx.$queryRaw`SELECT id FROM "ProviderApplication" WHERE id = ${applicationId} FOR UPDATE`;
    const application = await tx.providerApplication.findUnique({ where: { id: applicationId }, include: { identity: true, business: true } });
    if (!application) throw notFound();
    if (application.status !== 'PENDING') {
      if (application.status === decision && application.reviewReason === reason) return { id: application.id, status: application.status };
      throw conflict('This provider request has already been reviewed.');
    }
    // Legacy arbitrary-business ownership claims need VIS-33 verification.
    if (application.kind !== 'NEW_BUSINESS') throw conflict('This legacy request needs reviewed ownership verification.');
    await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${application.businessId} FOR UPDATE`;
    const business = await tx.business.findUniqueOrThrow({ where: { id: application.businessId } });
    if (business.approvalStatus !== 'PENDING' || business.publishedAt) throw conflict('The business review state changed.');
    const changed = await tx.membership.updateMany({ where: { identityId: application.identityId, businessId: application.businessId, role: 'OWNER', status: 'PENDING' }, data: { status: decision === 'APPROVED' ? 'ACTIVE' : 'REVOKED' } });
    if (changed.count !== 1) throw conflict('The intended applicant membership changed.');
    const now = new Date();
    await tx.providerApplication.update({ where: { id: application.id }, data: { status: decision, reviewReason: reason, reviewedAt: now, reviewedById: adminId } });
    await tx.business.update({ where: { id: application.businessId }, data: { approvalStatus: decision, reviewedAt: now, reviewedById: adminId } });
    const destination = application.identity.emailVerifiedAt ? application.identity.email : null;
    await tx.providerReviewNotification.create({ data: { applicationId, scope, destination, locale: application.identity.preferredLocale, status: destination ? 'QUEUED' : 'IN_APP' } });
    return { id: application.id, status: decision };
  });
}

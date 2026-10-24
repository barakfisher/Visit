import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BusinessApprovalStatus, MembershipRole, MembershipStatus, PlatformRole } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, forbidden, notFound } from '../http/errors.js';
import { authenticate } from '../security/sessions.js';
import { requireBusinessMembership, requirePublicBusiness } from '../security/tenant-context.js';
import { parseService, createBusinessService, deleteBusinessService, getBusinessService, listBusinessServices, listPublicServices, updateBusinessService } from '../repositories/services.js';

import { getBusinessSettings, getBusinessPolicy, saveBusinessPolicy, getBusinessAvailability, saveBusinessAvailability, listBusinessStaff, createBusinessStaff, saveStaffAvailability } from '../repositories/provider-settings.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const businessIdParams = z.object({ businessId: z.string().min(1) });
const serviceParams = z.object({ businessId: z.string().min(1), serviceId: z.string().min(1) });

function validTimezone(value: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

function mapUniqueConflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw conflict('A business or application with those details already exists.');
  throw error;
}

export async function registerProviderRoutes(app: FastifyInstance) {
  app.get('/v1/provider/businesses/:businessId', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId);
    return getBusinessSettings(context);
  });

  app.post('/v1/provider-applications', async (request, reply) => {
    const { identity } = await authenticate(request);
    const parsed = z.object({
      businessId: z.string().min(1).optional(),
      businessName: z.string().trim().min(2).max(120).optional(),
      slug: z.string().trim().toLowerCase().regex(slugPattern).max(80).optional(),
      timezone: z.string().refine(validTimezone, 'Use a valid IANA timezone.').optional(),
      message: z.string().trim().max(1000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Review the business details.', Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message])));
    const input = parsed.data;
    if (input.businessId && (input.businessName || input.slug || input.timezone)) throw new AppError(400, 'VALIDATION_ERROR', 'Choose an existing business or submit a new business request, not both.');
    if (!input.businessId && (!input.businessName || !input.slug || !input.timezone)) throw new AppError(400, 'VALIDATION_ERROR', 'A business name, URL name, and timezone are required for a new business.');

    try {
      const application = await prisma.$transaction(async (tx) => {
        let business;
        if (input.businessId) {
          business = await tx.business.findFirst({ where: { id: input.businessId, approvalStatus: BusinessApprovalStatus.APPROVED }, select: { id: true } });
          if (!business) throw notFound();
          const current = await tx.membership.findFirst({ where: { identityId: identity.id, businessId: business.id, role: MembershipRole.OWNER, status: MembershipStatus.ACTIVE } });
          if (current) throw conflict('You already manage this business.');
        } else {
          business = await tx.business.create({ data: { name: input.businessName!, slug: input.slug!, timezone: input.timezone!, approvalStatus: BusinessApprovalStatus.PENDING }, select: { id: true } });
        }

        const created = await tx.providerApplication.create({ data: { identityId: identity.id, businessId: business.id, message: input.message ?? null } });
        await tx.membership.upsert({
          where: { identityId_businessId_role: { identityId: identity.id, businessId: business.id, role: MembershipRole.OWNER } },
          create: { identityId: identity.id, businessId: business.id, role: MembershipRole.OWNER, status: MembershipStatus.PENDING },
          update: { status: MembershipStatus.PENDING },
        });
        return created;
      });
      reply.code(201);
      return { id: application.id, status: application.status, message: 'Your provider request is pending review. Provider tools remain locked until approval.' };
    } catch (error) { mapUniqueConflict(error); }
  });

  app.get('/v1/admin/provider-applications', async (request) => {
    const { identity } = await authenticate(request);
    if (identity.platformRole !== PlatformRole.ADMIN) throw forbidden();
    const applications = await prisma.providerApplication.findMany({
      where: { status: BusinessApprovalStatus.PENDING },
      include: { identity: { select: { id: true, email: true } }, business: { select: { id: true, name: true, slug: true, timezone: true, approvalStatus: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { applications };
  });

  app.post('/v1/admin/provider-applications/:applicationId/decision', async (request) => {
    const { identity } = await authenticate(request);
    if (identity.platformRole !== PlatformRole.ADMIN) throw forbidden();
    const params = z.object({ applicationId: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose approve or reject.');

    return prisma.$transaction(async (tx) => {
      const application = await tx.providerApplication.findUnique({ where: { id: params.data.applicationId } });
      if (!application) throw notFound();
      if (application.status !== BusinessApprovalStatus.PENDING) throw conflict('This provider request has already been reviewed.');
      const now = new Date();
      await tx.providerApplication.update({ where: { id: application.id }, data: { status: body.data.decision, reviewedAt: now, reviewedById: identity.id } });
      const business = await tx.business.findUnique({ where: { id: application.businessId }, select: { approvalStatus: true } });
      if (business?.approvalStatus === BusinessApprovalStatus.PENDING) {
        await tx.business.update({ where: { id: application.businessId }, data: { approvalStatus: body.data.decision, reviewedAt: now, reviewedById: identity.id } });
      }
      await tx.membership.updateMany({
        where: { identityId: application.identityId, businessId: application.businessId, role: MembershipRole.OWNER, status: MembershipStatus.PENDING },
        data: { status: body.data.decision === 'APPROVED' ? MembershipStatus.ACTIVE : MembershipStatus.REVOKED },
      });
      return { id: application.id, status: body.data.decision };
    });
  });

  app.get('/v1/businesses/:businessId/services', async (request) => {
    const parsed = businessIdParams.safeParse(request.params);
    if (!parsed.success) throw notFound();
    return { services: await listPublicServices(await requirePublicBusiness(parsed.data.businessId)) };
  });

  app.get('/v1/provider/businesses/:businessId/services', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId);
    return { services: await listBusinessServices(context) };
  });

  app.post('/v1/provider/businesses/:businessId/services', async (request, reply) => {
    const params = businessIdParams.safeParse(request.params);
    const input = parseService(request.body);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    reply.code(201);
    return createBusinessService(context, input);
  });

  app.get('/v1/provider/businesses/:businessId/services/:serviceId', async (request) => {
    const params = serviceParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId);
    return getBusinessService(context, params.data.serviceId);
  });

  app.patch('/v1/provider/businesses/:businessId/services/:serviceId', async (request) => {
    const params = serviceParams.safeParse(request.params);
    const input = parseService(request.body, true);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return updateBusinessService(context, params.data.serviceId, input);
  });

  app.delete('/v1/provider/businesses/:businessId/services/:serviceId', async (request) => {
    const params = serviceParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return deleteBusinessService(context, params.data.serviceId);
  });

  app.get('/v1/provider/businesses/:businessId/booking-policy', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return getBusinessPolicy(context);
  });

  app.put('/v1/provider/businesses/:businessId/booking-policy', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return saveBusinessPolicy(context, request.body as Parameters<typeof saveBusinessPolicy>[1]);
  });

  app.get('/v1/provider/businesses/:businessId/availability-rules', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return getBusinessAvailability(context);
  });

  app.put('/v1/provider/businesses/:businessId/availability-rules', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return saveBusinessAvailability(context, request.body as Parameters<typeof saveBusinessAvailability>[1]);
  });

  app.get('/v1/provider/businesses/:businessId/staff', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return listBusinessStaff(context);
  });

  app.post('/v1/provider/businesses/:businessId/staff', async (request, reply) => {
    const params = businessIdParams.safeParse(request.params);
    const body = z.object({ displayName: z.string().trim().min(2).max(120), serviceIds: z.array(z.string().min(1)).min(1).max(100) }).safeParse(request.body);
    if (!params.success || !body.success || new Set(body.data.serviceIds).size !== body.data.serviceIds.length) throw new AppError(400, 'VALIDATION_ERROR', 'Provide a staff name and one or more unique services.');
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    reply.code(201);
    return createBusinessStaff(context, body.data);
  });

  app.put('/v1/provider/businesses/:businessId/staff/:staffId/availability-rules', async (request) => {
    const params = z.object({ businessId: z.string().min(1), staffId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return saveStaffAvailability(context, params.data.staffId, request.body as Parameters<typeof saveStaffAvailability>[2]);
  });
}

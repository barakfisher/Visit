import { previewSchedule } from '../repositories/ScheduleImpact.service.js';
import { publicationReadiness, setPublication, withBusinessConfiguration } from '../repositories/publication.js';
import { reviewProviderApplication } from '../repositories/provider-review.js';
import { PILOT_TIMEZONE, providerSharePath } from '@visit/contracts';
import { env } from '../env.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BusinessApprovalStatus, MembershipRole, MembershipStatus, PlatformRole } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, forbidden, notFound } from '../http/errors.js';
import { authenticate } from '../security/sessions.js';
import { requireBusinessMembership, requirePublicBusiness } from '../security/tenant-context.js';
import { parseService, createBusinessService, deleteBusinessService, getBusinessService, listBusinessServices, listPublicServices, updateBusinessService } from '../repositories/services.js';

import { getBusinessSettings, getBusinessPolicy, saveBusinessPolicy, getBusinessAvailability, saveBusinessAvailability, listBusinessStaff, createBusinessStaff, saveStaffAvailability, getStaffAvailability, updateBusinessStaff } from '../repositories/provider-settings.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const businessIdParams = z.object({ businessId: z.string().min(1) });
const serviceParams = z.object({ businessId: z.string().min(1), serviceId: z.string().min(1) });

function mapUniqueConflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw conflict('A business or application with those details already exists.');
  throw error;
}

export async function registerProviderRoutes(app: FastifyInstance, { reviewScope = 'live' }: { reviewScope?: string } = {}) {
  app.get('/v1/provider/businesses/:businessId', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId);
    return getBusinessSettings(context);
  });

  app.get('/v1/provider/businesses/:businessId/publication', async request => {
    const { businessId } = businessIdParams.parse(request.params);
    const { identity } = await authenticate(request);
    await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']);
    return prisma.$transaction(tx => publicationReadiness(tx, businessId), { isolationLevel: 'RepeatableRead', timeout: 15000 });
  });
  app.get('/v1/provider/businesses/:businessId/sharing', async request => {
    const { businessId } = businessIdParams.parse(request.params);
    const { identity } = await authenticate(request);
    await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { slug: true, approvalStatus: true, publishedAt: true, deletedAt: true } });
    const path = providerSharePath(business.slug);
    const available = !!path && business.approvalStatus === 'APPROVED' && !!business.publishedAt && !business.deletedAt;
    return { available, url: available ? new URL(path!, env.WEB_APP_URL).href : null };
  });
  app.put('/v1/provider/businesses/:businessId/publication', async request => {
    const { businessId } = businessIdParams.parse(request.params);
    const { published } = z.strictObject({ published: z.boolean() }).parse(request.body);
    const { identity } = await authenticate(request);
    return setPublication(await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']), published);
  });
  app.patch('/v1/provider/businesses/:businessId', async request => {
    const { businessId } = businessIdParams.parse(request.params);
    const input = z.strictObject({ name: z.string().trim().min(2).max(120).optional(), location: z.string().trim().min(2).max(200).optional(), category: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(2000).nullable().optional(), contactEmail: z.string().trim().email().max(254).nullable().optional(), contactPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional() }).refine(value => Object.keys(value).length > 0).parse(request.body);
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']);
    return withBusinessConfiguration(context, tx => tx.business.update({ where: { id: businessId }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.location !== undefined ? { location: input.location } : {}), ...(input.category !== undefined ? { category: input.category } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}), ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}) }, select: { id: true, name: true, location: true, category: true, description: true, contactEmail: true, contactPhone: true } }));
  });

  app.post('/v1/provider-applications', async (request, reply) => {
    const { identity } = await authenticate(request);
    const parsed = z.strictObject({
      businessId: z.string().min(1).optional(),
      businessName: z.string().trim().min(2).max(120).optional(),
      slug: z.string().trim().toLowerCase().regex(slugPattern).max(80).optional(),
      timezone: z.literal(PILOT_TIMEZONE, { error: 'Pilot businesses use local Israeli time (Asia/Jerusalem).' }).optional(),
      message: z.string().trim().max(1000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Review the business details.', Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message])));
    const input = parsed.data;
    if (input.businessId) throw new AppError(400, 'INVITATION_REQUIRED', 'Joining an existing business requires a verified invitation or ownership review.');
    if (!input.businessId && (!input.businessName || !input.slug)) throw new AppError(400, 'VALIDATION_ERROR', 'A business name and URL name are required for a new business.');

    try {
      const application = await prisma.$transaction(async (tx) => {
        const business = await tx.business.create({ data: { name: input.businessName!, slug: input.slug!, timezone: PILOT_TIMEZONE, approvalStatus: BusinessApprovalStatus.PENDING }, select: { id: true } });

        const created = await tx.providerApplication.create({ data: { kind: 'NEW_BUSINESS', identityId: identity.id, businessId: business.id, message: input.message ?? null } });
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

  app.get('/v1/provider-applications', async request => {
    const { identity } = await authenticate(request);
    return { applications: await prisma.providerApplication.findMany({ where: { identityId: identity.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, select: { id: true, status: true, reviewReason: true, reviewedAt: true, createdAt: true, business: { select: { id: true, name: true } }, notification: { select: { status: true, provider: true } } } }) };
  });

  app.get('/v1/admin/provider-applications', async (request) => {
    const { identity } = await authenticate(request);
    if (identity.platformRole !== PlatformRole.ADMIN) throw forbidden();
    const applications = await prisma.providerApplication.findMany({
      where: { status: BusinessApprovalStatus.PENDING },
      include: { identity: { select: { id: true, email: true, phone: true } }, business: { select: { id: true, name: true, slug: true, timezone: true, approvalStatus: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100,
    });
    return { applications };
  });

  app.post('/v1/admin/provider-applications/:applicationId/decision', async (request) => {
    const actor = await authenticate(request);
    const { identity } = actor;
    if (identity.platformRole !== PlatformRole.ADMIN) throw forbidden();
    const params = z.object({ applicationId: z.string().min(1) }).safeParse(request.params);
    const body = z.strictObject({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().min(5).max(1000) }).safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(400, 'VALIDATION_ERROR', 'Choose approve or reject and provide a reason (5–1000 characters).');
    return reviewProviderApplication(actor, params.data.applicationId, body.data.decision, body.data.reason, reviewScope);
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

  app.post('/v1/provider/businesses/:businessId/availability-rules/preview', async request => {
    const { businessId, staffId } = z.object({ businessId: z.string().min(1), staffId: z.string().min(1).optional() }).parse(request.params);
    const session = await authenticate(request);
    return previewSchedule(await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']), request.body, staffId, session);
  });

  app.put('/v1/provider/businesses/:businessId/availability-rules', async (request) => {
    const params = businessIdParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const session = await authenticate(request);
    const { identity } = session;
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return saveBusinessAvailability(context, request.body, z.string().regex(/^[a-f0-9]{64}$/).optional().parse(request.headers['x-visit-schedule-preview']), session);
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
    const body = z.strictObject({ displayName: z.string().trim().min(2).max(120), serviceIds: z.array(z.string().min(1)).min(1).max(100), parallelCapacity: z.number().int().min(1).max(100).optional(), creationKey: z.string().uuid().optional() }).safeParse(request.body);
    if (!params.success || !body.success || new Set(body.data.serviceIds).size !== body.data.serviceIds.length) throw new AppError(400, 'VALIDATION_ERROR', 'Provide a staff name and one or more unique services.');
    const { identity } = await authenticate(request);
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    reply.code(201);
    return createBusinessStaff(context, body.data);
  });

  app.post('/v1/provider/businesses/:businessId/staff/:staffId/availability-rules/preview', async request => {
    const { businessId, staffId } = z.object({ businessId: z.string().min(1), staffId: z.string().min(1).optional() }).parse(request.params);
    const session = await authenticate(request);
    return previewSchedule(await requireBusinessMembership(session.identity.id, businessId, ['OWNER', 'MANAGER']), request.body, staffId, session);
  });

  app.put('/v1/provider/businesses/:businessId/staff/:staffId/availability-rules', async (request) => {
    const params = z.object({ businessId: z.string().min(1), staffId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw notFound();
    const session = await authenticate(request);
    const { identity } = session;
    const context = await requireBusinessMembership(identity.id, params.data.businessId, [MembershipRole.OWNER, MembershipRole.MANAGER]);
    return saveStaffAvailability(context, params.data.staffId, request.body, z.string().regex(/^[a-f0-9]{64}$/).optional().parse(request.headers['x-visit-schedule-preview']), session);
  });
  app.get('/v1/provider/businesses/:businessId/staff/:staffId/availability-rules', async request => {
    const { businessId, staffId } = z.strictObject({ businessId: z.string().min(1), staffId: z.string().min(1) }).parse(request.params);
    const { identity } = await authenticate(request);
    return getStaffAvailability(await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']), staffId);
  });
  app.patch('/v1/provider/businesses/:businessId/staff/:staffId', async request => {
    const { businessId, staffId } = z.strictObject({ businessId: z.string().min(1), staffId: z.string().min(1) }).parse(request.params);
    const input = z.strictObject({ displayName: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional(), parallelCapacity: z.number().int().min(1).max(100).optional(), serviceIds: z.array(z.string().min(1)).max(100).optional() }).refine(v => Object.keys(v).length > 0).parse(request.body);
    const { identity } = await authenticate(request);
    return updateBusinessStaff(await requireBusinessMembership(identity.id, businessId, ['OWNER', 'MANAGER']), staffId, input);
  });
}

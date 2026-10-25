import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { providerSharePath } from '@visit/contracts';
import { prisma } from '../db/client.js';
import { AppError, notFound, unauthenticated } from '../http/errors.js';
import { authenticate } from '../security/sessions.js';
import { publicBusinessWhere } from '../security/business-eligibility.js';
import { retrySerializable } from '../scheduling/booking-transaction.js';
const slug = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const publicSelect = { id: true, name: true, slug: true, timezone: true, location: true, category: true } as const;
export async function registerSavedProviders(app: FastifyInstance) {
  app.get('/api/provider-links/:slug', async request => {
    const params = z.strictObject({ slug }).safeParse(request.params);
    if (!params.success) throw notFound();
    const provider = await prisma.business.findFirst({ where: { slug: params.data.slug, ...publicBusinessWhere }, select: publicSelect });
    if (!provider) throw notFound();
    return { provider, path: providerSharePath(provider.slug) };
  });
  app.post('/api/me/providers', async request => {
    const actor = await authenticate(request);
    const input = z.union([z.strictObject({ slug }), z.strictObject({ businessId: id })]).parse(request.body);
    const expected = request.headers['x-visit-expected-identity'];
    if (expected !== undefined && expected !== actor.identity.id) throw new AppError(409, 'SESSION_CHANGED', 'The signed-in account changed. Reopen the provider link.');
    return retrySerializable(() => prisma.$transaction(async tx => {
      const sessions = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Session" WHERE id = ${actor.sessionId} AND "identityId" = ${actor.identity.id} AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') AND "refreshExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
      if (!sessions.length) throw unauthenticated();
      const target = await tx.business.findFirst({ where: { ...('slug' in input ? { slug: input.slug } : { id: input.businessId }), ...publicBusinessWhere }, select: publicSelect });
      if (!target) throw notFound();
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${target.id} FOR SHARE`;
      const provider = await tx.business.findFirst({ where: { id: target.id, ...publicBusinessWhere }, select: publicSelect });
      if (!provider) throw notFound();
      const saved = await tx.savedProvider.upsert({ where: { identityId_businessId: { identityId: actor.identity.id, businessId: provider.id } }, create: { identityId: actor.identity.id, businessId: provider.id, displayName: provider.name }, update: { displayName: provider.name }, select: { id: true, savedAt: true } });
      return { saved: { ...saved, businessId: provider.id }, provider };
    }));
  });
  app.get('/api/me/providers', async request => {
    const { identity } = await authenticate(request);
    const { cursor } = z.strictObject({ cursor: id.optional() }).parse(request.query);
    const boundary = cursor ? await prisma.savedProvider.findFirst({ where: { id: cursor, identityId: identity.id }, select: { id: true, savedAt: true } }) : undefined;
    if (cursor && !boundary) throw new AppError(400, 'INVALID_CURSOR', 'Refresh your providers list.');
    const rows = await prisma.savedProvider.findMany({ where: { identityId: identity.id, ...(boundary ? { OR: [{ savedAt: { lt: boundary.savedAt } }, { savedAt: boundary.savedAt, id: { lt: boundary.id } }] } : {}) }, orderBy: [{ savedAt: 'desc' }, { id: 'desc' }], take: 51, select: { id: true, businessId: true, displayName: true, savedAt: true, business: { select: { ...publicSelect, approvalStatus: true, publishedAt: true, deletedAt: true } } } });
    const page = rows.slice(0, 50);
    return { providers: page.map(row => {
      const available = row.business.approvalStatus === 'APPROVED' && !!row.business.publishedAt && !row.business.deletedAt;
      const { approvalStatus: _approval, publishedAt: _published, deletedAt: _deleted, ...publicFields } = row.business;
      return { id: row.id, businessId: row.businessId, savedAt: row.savedAt, available, ...(available ? { provider: publicFields } : { provider: { id: row.businessId, name: row.displayName } }) };
    }), nextCursor: rows.length > 50 ? page[page.length - 1]!.id : null };
  });
  app.delete('/api/me/providers/:businessId', async request => {
    const { identity } = await authenticate(request);
    const expected = request.headers['x-visit-expected-identity'];
    if (expected !== undefined && expected !== identity.id) throw new AppError(409, 'SESSION_CHANGED', 'The signed-in account changed. Refresh your providers.');
    const { businessId } = z.strictObject({ businessId: id }).parse(request.params);
    await prisma.savedProvider.deleteMany({ where: { identityId: identity.id, businessId } });
    return { removed: true };
  });
}

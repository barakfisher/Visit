import { prisma } from '../db/client.js';
import { requirePublicBusiness } from '../security/tenant-context.js';
import { customerContactReadiness } from '../security/customer-contact.utils.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { AppError } from '../http/errors.js';
import { authenticate, issueSessionToken } from '../security/sessions.js';
import { accountMethodsService } from '../security/account-methods.js';
export async function registerAccountMethods(app: FastifyInstance, { account = accountMethodsService }: { account?: typeof accountMethodsService } = {}) {
  app.patch('/api/account/profile', async request => {
    const { identity } = await authenticate(request);
    const input = z.strictObject({ displayName: z.string().trim().min(2).max(120) }).parse(request.body);
    return prisma.identity.update({ where: { id: identity.id }, data: input, select: { displayName: true } });
  });
  app.get('/api/providers/:businessId/contact-readiness', async request => {
    const { identity } = await authenticate(request);
    const { businessId } = z.object({ businessId: z.string().min(1) }).parse(request.params);
    await requirePublicBusiness(businessId);
    const policy = await prisma.bookingPolicy.findUnique({ where: { businessId } });
    if (!policy) throw new AppError(409, 'BUSINESS_NOT_READY', 'This business has not configured its booking policy.');
    const profile = await prisma.identity.findUniqueOrThrow({ where: { id: identity.id }, select: { displayName: true, phone: true, phoneVerifiedAt: true, email: true, emailVerifiedAt: true } });
    return { ...customerContactReadiness(policy, profile), profile };
  });
  app.get('/api/account/sign-in-methods', async request => account.list(await authenticate(request)));
  app.post('/api/account/contact-challenges', async (request, reply) => {
    const input = z.strictObject({ channel: z.enum(['email', 'phone']), destination: z.string().min(1).max(254), consent: z.literal(true) }).parse(request.body);
    const result = await account.start(input, await authenticate(request), request.ip); reply.code(202); return result;
  });
  app.post('/api/account/contact-challenges/verify', async (request, reply) => {
    const input = z.strictObject({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().regex(/^\d{6}$/), consent: z.literal(true) }).parse(request.body);
    const result = await account.verify(input, await authenticate(request), request.ip);
    return { ...issueSessionToken(reply, request, result.sessionToken!, result.refreshExpiresAt), identity: { id: result.identityId } };
  });
  app.post('/api/account/sign-in-methods/remove', async (request, reply) => {
    const input = z.strictObject({ method: z.enum(['email', 'phone', 'google']), id: z.string().min(1).max(128).optional(), consent: z.literal(true) }).refine(value => value.method === 'google' ? Boolean(value.id) : value.id === undefined).parse(request.body);
    const result = await account.remove(input, await authenticate(request), request.ip);
    return { ...issueSessionToken(reply, request, result.sessionToken!, result.refreshExpiresAt), identity: { id: result.identityId } };
  });
  app.post('/__dev/account/contact-code', async request => {
    if (env.NODE_ENV !== 'development' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const input = z.strictObject({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(request.body);
    return account.localCode(input.challenge, await authenticate(request));
  });
}

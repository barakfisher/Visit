import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../security/sessions.js';
import { team, createInvitation, revokeInvitation, inspectInvitation, revokeMember, ownershipCases, createOwnershipCase, decideOwnership } from '../repositories/business-access.js';
const businessParams = z.object({ businessId: z.string().min(1), id: z.string().min(1).optional() });
const tokenBody = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export async function registerBusinessAccess(app: FastifyInstance) {
  app.get('/v1/provider/businesses/:businessId/team', async request => team(await authenticate(request), businessParams.parse(request.params).businessId));
  app.post('/v1/provider/businesses/:businessId/invitations', async request => {
    const input = z.strictObject({ role: z.enum(['MANAGER', 'STAFF']), channel: z.enum(['email', 'phone']), recipient: z.string().trim().min(8).max(254) }).superRefine((v, ctx) => { if (v.channel === 'email' && !z.email().safeParse(v.recipient).success) ctx.addIssue({ code: 'custom', message: 'Invalid email.' }); }).parse(request.body);
    return createInvitation(await authenticate(request), businessParams.parse(request.params).businessId, input);
  });
  app.delete('/v1/provider/businesses/:businessId/invitations/:id', async request => { const p = businessParams.parse(request.params); return revokeInvitation(await authenticate(request), p.businessId, p.id!); });
  app.delete('/v1/provider/businesses/:businessId/members/:id', async request => { const p = businessParams.parse(request.params); return revokeMember(await authenticate(request), p.businessId, p.id!); });
  for (const action of ['preview', 'accept'] as const) app.post(`/v1/business-invitations/${action}`, async request => inspectInvitation(await authenticate(request), tokenBody.parse(request.body).token, action === 'accept'));
  app.get('/v1/admin/ownership-cases', async request => ownershipCases(await authenticate(request)));
  app.post('/v1/admin/ownership-cases', async request => createOwnershipCase(await authenticate(request), z.strictObject({ businessId: z.string().min(1), claimantIdentityId: z.string().min(1), caseReference: z.string().trim().min(5).max(120), evidenceKind: z.enum(['CURRENT_OWNER_CONSENT', 'REGISTRATION_RECORDS', 'PLATFORM_RECORDS']), evidenceSummary: z.string().trim().min(20).max(2000) }).parse(request.body)));
  app.post('/v1/admin/ownership-cases/:id/decision', async request => { const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const input = z.strictObject({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().min(5).max(1000) }).parse(request.body); return decideOwnership(await authenticate(request), id, input.decision, input.reason); });
}

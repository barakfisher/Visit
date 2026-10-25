import { prisma } from '../db/client.js';
import { lockIdentitySecurity } from './account-security.js';
export async function promoteAdministrator(input: { identity: string; operator: string; reason: string }) {
  if (!input.identity || !input.operator.trim() || input.reason.trim().length < 10) throw new Error('Reviewed operator identity and ownership evidence are required.');
  await prisma.$transaction(async tx => {
    await lockIdentitySecurity(tx, input.identity);
    const person = await tx.identity.findUniqueOrThrow({ where: { id: input.identity } });
    if (!person.emailVerifiedAt && !person.phoneVerifiedAt) throw new Error('A verified identity contact and reviewed ownership evidence are required.');
    if (person.platformRole === 'ADMIN') return;
    await tx.adminRoleAudit.create({ data: { identityId: person.id, operator: input.operator, reason: input.reason, previousRole: person.platformRole } });
    await tx.identity.update({ where: { id: person.id }, data: { platformRole: 'ADMIN', securityVersion: { increment: 1 } } });
    await tx.session.updateMany({ where: { identityId: person.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

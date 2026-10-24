import { prisma } from '../db/client.js';
import { validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';

export async function listCustomerBookings(session: AuthenticatedSession, activeOnly = false) {
  await validateAuthenticatedSession(session);
  return prisma.booking.findMany({
    where: { customerId: session.identity.id, ...(activeOnly ? { status: 'CONFIRMED' as const, startsAt: { gte: new Date() } } : {}) },
    include: {
      business: { select: { id: true, name: true, timezone: true } },
      service: { select: { id: true, name: true, durationMinutes: true, priceMinor: true, currency: true } },
      staff: { select: { displayName: true } },
    },
    orderBy: { startsAt: 'asc' },
  });
}

export async function listProviderBookings(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  return prisma.booking.findMany({ where: { businessId: context.businessId }, include: { service: { select: { name: true } }, staff: { select: { displayName: true } } }, orderBy: { startsAt: 'asc' } });
}

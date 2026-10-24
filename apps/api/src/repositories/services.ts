import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import type { AuthorizedBusinessContext, PublicBusinessContext } from '../security/tenant-context.js';
import { assertMembershipRole } from '../security/tenant-context.js';
import { notFound } from '../http/errors.js';

export async function listPublicServices(context: PublicBusinessContext) {
  return prisma.service.findMany({
    where: { businessId: context.businessId, active: true },
    select: { id: true, name: true, description: true, durationMinutes: true, priceMinor: true, currency: true },
    orderBy: { name: 'asc' },
  });
}

export async function listBusinessServices(context: AuthorizedBusinessContext) {
  return prisma.service.findMany({
    where: { businessId: context.businessId },
    orderBy: { name: 'asc' },
  });
}

export async function getBusinessService(context: AuthorizedBusinessContext, serviceId: string) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId: context.businessId } });
  if (!service) throw notFound();
  return service;
}

export async function createBusinessService(
  context: AuthorizedBusinessContext,
  input: Pick<Prisma.ServiceUncheckedCreateInput, 'name' | 'durationMinutes'> & Partial<Pick<Prisma.ServiceUncheckedCreateInput, 'description' | 'priceMinor' | 'currency'>>,
) {
  assertMembershipRole(context, ['OWNER', 'MANAGER']);
  return prisma.service.create({ data: { ...input, description: input.description ?? null, priceMinor: input.priceMinor ?? null, currency: input.currency ?? null, businessId: context.businessId } });
}

export async function updateBusinessService(
  context: AuthorizedBusinessContext,
  serviceId: string,
  input: Partial<Pick<Prisma.ServiceUpdateInput, 'name' | 'description' | 'durationMinutes' | 'priceMinor' | 'currency' | 'active'>>,
) {
  assertMembershipRole(context, ['OWNER', 'MANAGER']);
  const exists = await prisma.service.findFirst({ where: { id: serviceId, businessId: context.businessId }, select: { id: true } });
  if (!exists) throw notFound();
  return prisma.service.update({ where: { id: serviceId, businessId: context.businessId }, data: input });
}

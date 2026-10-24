import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import type { AuthorizedBusinessContext, PublicBusinessContext } from '../security/tenant-context.js';
import { validateBusinessContext, validatePublicBusinessContext } from '../security/tenant-context.js';
import { AppError, notFound } from '../http/errors.js';

function requireKnownFields(input: object, fields: readonly string[]) {
  if (Object.keys(input).some((key) => !fields.includes(key))) throw new AppError(400, 'VALIDATION_ERROR', 'Only service fields may be changed.');
}

export async function listPublicServices(context: PublicBusinessContext) {
  await validatePublicBusinessContext(context);
  return prisma.service.findMany({
    where: { businessId: context.businessId, active: true },
    select: { id: true, name: true, description: true, durationMinutes: true, priceMinor: true, currency: true },
    orderBy: { name: 'asc' },
  });
}

export async function listBusinessServices(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context);
  return prisma.service.findMany({
    where: { businessId: context.businessId },
    orderBy: { name: 'asc' },
  });
}

export async function getBusinessService(context: AuthorizedBusinessContext, serviceId: string) {
  await validateBusinessContext(context);
  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId: context.businessId } });
  if (!service) throw notFound();
  return service;
}

export async function createBusinessService(
  context: AuthorizedBusinessContext,
  input: Pick<Prisma.ServiceUncheckedCreateInput, 'name' | 'durationMinutes'> & Partial<Pick<Prisma.ServiceUncheckedCreateInput, 'description' | 'priceMinor' | 'currency'>>,
) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  requireKnownFields(input, ['name', 'description', 'durationMinutes', 'priceMinor', 'currency']);
  return prisma.service.create({ data: { ...input, description: input.description ?? null, priceMinor: input.priceMinor ?? null, currency: input.currency ?? null, businessId: context.businessId } });
}

export async function updateBusinessService(
  context: AuthorizedBusinessContext,
  serviceId: string,
  input: Partial<Pick<Prisma.ServiceUpdateInput, 'name' | 'description' | 'durationMinutes' | 'priceMinor' | 'currency' | 'active'>>,
) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  requireKnownFields(input, ['name', 'description', 'durationMinutes', 'priceMinor', 'currency', 'active']);
  const exists = await prisma.service.findFirst({ where: { id: serviceId, businessId: context.businessId }, select: { id: true } });
  if (!exists) throw notFound();
  return prisma.service.update({ where: { id: serviceId, businessId: context.businessId }, data: input });
}

export async function deleteBusinessService(context: AuthorizedBusinessContext, serviceId: string) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  const where = { id: serviceId, businessId: context.businessId };
  const archive = async () => {
    await prisma.service.update({ where, data: { active: false } });
    return { deleted: false, archived: true, message: 'This service has booking history, so it was archived and removed from discovery.' };
  };
  const service = await prisma.service.findFirst({ where, select: { id: true } });
  if (!service) throw notFound();
  // Any historical booking has a restrictive FK, including cancelled/expired rows.
  if (await prisma.booking.count({ where: { businessId: context.businessId, serviceId } })) return archive();
  try { await prisma.service.delete({ where }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003') return archive();
    throw error;
  }
  return { deleted: true, archived: false };
}

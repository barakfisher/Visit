import { validateService, type ServiceInput } from '@visit/contracts';
import { prisma } from '../db/client.js';
import type { AuthorizedBusinessContext, PublicBusinessContext } from '../security/tenant-context.js';
import { validateBusinessContext, validatePublicBusinessContext } from '../security/tenant-context.js';
import { AppError, notFound } from '../http/errors.js';

export function parseService(input: unknown, partial = false) {
  const errors = validateService(input, partial);
  if (Object.keys(errors).length) throw new AppError(400, 'VALIDATION_ERROR', 'Review the service details.', errors);
  return input as ServiceInput;
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
  input: ServiceInput,
) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  parseService(input);
  if ('active' in input) throw new AppError(400, 'VALIDATION_ERROR', 'New services start active.');
  return prisma.service.create({ data: { ...input, name: input.name.trim(), description: input.description?.trim() ?? null, priceMinor: input.priceMinor ?? null, currency: input.currency ?? null, businessId: context.businessId } });
}

export async function updateBusinessService(
  context: AuthorizedBusinessContext,
  serviceId: string,
  input: Partial<ServiceInput>,
) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  parseService(input, true);
  return prisma.$transaction(async tx => {
    // Serialize read/merge/write so partial price edits cannot produce a mismatched pair.
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${serviceId} AND "businessId" = ${context.businessId} FOR UPDATE`;
    const existing = await tx.service.findFirst({ where: { id: serviceId, businessId: context.businessId } });
    if (!existing) throw notFound();
    parseService({ name: existing.name, durationMinutes: existing.durationMinutes, priceMinor: existing.priceMinor, currency: existing.currency, ...input });
    return tx.service.update({ where: { id: serviceId, businessId: context.businessId }, data: { ...input, ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(typeof input.description === 'string' ? { description: input.description.trim() } : {}) } });
  });
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

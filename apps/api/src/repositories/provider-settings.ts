import { assertSafeSchedule, fenceScheduleSession } from './ScheduleImpact.service.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { withBusinessConfiguration } from './publication.js';
import { prisma } from '../db/client.js';
import { DEFAULT_BOOKING_POLICY, parseAvailabilityRules, parseBookingPolicy } from '../scheduling/rules.js';
import { AppError, notFound } from '../http/errors.js';
import { conflict } from '../http/errors.js';
import { isDatabaseCapacityError } from '../scheduling/booking-transaction.js';
import { releaseHold } from '../scheduling/reservations.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';

const managers = ['OWNER', 'MANAGER'] as const;
const staffProjection = { id: true, businessId: true, displayName: true, active: true, parallelCapacity: true } as const;
export type AvailabilityRules = {
  weekly: { weekday: number; intervals: { startLocal: string; endLocal: string }[] }[];
  overrides: { date: string; isOpen: boolean; startLocal?: string | undefined; endLocal?: string | undefined }[];
};
export type PolicyInput = {
  requireCustomerName?: boolean | undefined; requireVerifiedPhone?: boolean | undefined; requireVerifiedEmail?: boolean | undefined;
  minimumNoticeMinutes: number; maximumAdvanceDays: number;
  bufferBeforeMinutes: number; bufferAfterMinutes: number;
  cancellationCutoffMinutes: number; rescheduleCutoffMinutes: number;
};

export async function getBusinessSettings(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context);
  const business = await prisma.business.findUnique({ where: { id: context.businessId }, select: { id: true, name: true, slug: true, timezone: true, approvalStatus: true, publishedAt: true, location: true, category: true, description: true, contactEmail: true, contactPhone: true } });
  if (!business) throw notFound();
  return { business, role: context.role };
}

export async function getBusinessPolicy(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  return { policy: await prisma.bookingPolicy.findUnique({ where: { businessId: context.businessId } }), defaults: DEFAULT_BOOKING_POLICY };
}

export async function saveBusinessPolicy(context: AuthorizedBusinessContext, input: PolicyInput) {
  await validateBusinessContext(context, managers);
  input = parseBookingPolicy(input);
  const data = {
    ...(input.requireCustomerName !== undefined ? { requireCustomerName: input.requireCustomerName } : {}),
    ...(input.requireVerifiedPhone !== undefined ? { requireVerifiedPhone: input.requireVerifiedPhone } : {}),
    ...(input.requireVerifiedEmail !== undefined ? { requireVerifiedEmail: input.requireVerifiedEmail } : {}),
    minimumNoticeMinutes: input.minimumNoticeMinutes, maximumAdvanceDays: input.maximumAdvanceDays,
    bufferBeforeMinutes: input.bufferBeforeMinutes, bufferAfterMinutes: input.bufferAfterMinutes,
    cancellationCutoffMinutes: input.cancellationCutoffMinutes, rescheduleCutoffMinutes: input.rescheduleCutoffMinutes,
  };
  const result = await withBusinessConfiguration(context, async tx => {
    const previous = await tx.bookingPolicy.findUnique({ where: { businessId: context.businessId } });
    const changed = (['requireCustomerName', 'requireVerifiedPhone', 'requireVerifiedEmail'] as const).some(key => data[key] !== undefined && data[key] !== (previous?.[key] ?? false));
    const expired = changed ? await tx.booking.findMany({ where: { businessId: context.businessId, status: 'HELD' }, select: { id: true, customerId: true } }) : [];
    if (expired.length) await tx.booking.updateMany({ where: { businessId: context.businessId, status: 'HELD' }, data: { status: 'EXPIRED', holdExpiresAt: null } });
    const policy = await tx.bookingPolicy.upsert({ where: { businessId: context.businessId }, create: { ...data, businessId: context.businessId }, update: data });
    return { policy, expired };
  });
  await Promise.allSettled(result.expired.flatMap(hold => hold.customerId ? [releaseHold(hold.id, hold.customerId)] : []));
  return result.policy;
}

export async function getBusinessAvailability(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  const [weekly, overrides] = await Promise.all([
    prisma.businessWeeklyAvailability.findMany({ where: { businessId: context.businessId }, orderBy: [{ weekday: 'asc' }, { startLocal: 'asc' }] }),
    prisma.scheduleOverride.findMany({ where: { businessId: context.businessId }, orderBy: { date: 'asc' } }),
  ]);
  return { weekly, overrides };
}

export async function saveBusinessAvailability(context: AuthorizedBusinessContext, input: unknown, expectedToken?: string, session?: AuthenticatedSession) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const rules = parseAvailabilityRules(input, business.timezone);
  const weekly = rules.weekly.flatMap(day => day.intervals.map(hours => ({ businessId, weekday: day.weekday, startLocal: hours.startLocal, endLocal: hours.endLocal })));
  const overrides = rules.overrides.map(day => ({ businessId, date: new Date(`${day.date}T00:00:00.000Z`), isOpen: day.isOpen, startLocal: day.isOpen ? day.startLocal! : null, endLocal: day.isOpen ? day.endLocal! : null }));
  await withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    await assertSafeSchedule(tx, businessId, rules, undefined, expectedToken);
    await tx.businessWeeklyAvailability.deleteMany({ where: { businessId } });
    await tx.scheduleOverride.deleteMany({ where: { businessId } });
    if (weekly.length) await tx.businessWeeklyAvailability.createMany({ data: weekly });
    if (overrides.length) await tx.scheduleOverride.createMany({ data: overrides });
  });
  return { saved: true, weeklyIntervals: weekly.length, overrides: overrides.length };
}

export async function listBusinessStaff(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  return { staff: await prisma.staff.findMany({ where: { businessId: context.businessId }, select: { ...staffProjection, services: { include: { service: { select: { id: true, name: true } } } } }, orderBy: { displayName: 'asc' } }) };
}

export async function createBusinessStaff(context: AuthorizedBusinessContext, input: { displayName: string; serviceIds: string[]; parallelCapacity?: number | undefined; creationKey?: string | undefined }) {
  await validateBusinessContext(context, managers);
  input = z.strictObject({ displayName: z.string().trim().min(2).max(120), serviceIds: z.array(z.string().min(1)).min(1).max(100), parallelCapacity: z.number().int().min(1).max(100).optional(), creationKey: z.string().uuid().optional() }).parse(input);
  const businessId = context.businessId;
  const ids = [...new Set(input.serviceIds)];
  if (!ids.length || ids.length !== input.serviceIds.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Every selected service must be active in this business.');
  }
  return withBusinessConfiguration(context, async tx => {
    const creationFingerprint = input.creationKey ? createHash('sha256').update(JSON.stringify([input.displayName, input.parallelCapacity ?? 1, [...ids].sort()])).digest('hex') : null;
    if (input.creationKey) {
      const prior = await tx.staff.findUnique({ where: { businessId_creationKey: { businessId, creationKey: input.creationKey } } });
      if (prior) { if (prior.creationFingerprint !== creationFingerprint) throw conflict('This staff request was already used for different details.'); const { creationKey: _key, creationFingerprint: _fingerprint, ...fields } = prior; return fields; }
    }
    if (await tx.service.count({ where: { businessId, id: { in: ids }, active: true } }) !== ids.length) throw new AppError(400, 'VALIDATION_ERROR', 'Every selected service must be active in this business.');
    const staff = await tx.staff.create({ data: { businessId, displayName: input.displayName, parallelCapacity: input.parallelCapacity ?? 1, creationKey: input.creationKey ?? null, creationFingerprint }, select: staffProjection });
    await tx.staffService.createMany({ data: ids.map(serviceId => ({ businessId, staffId: staff.id, serviceId })) });
    return staff;
  });
}

export async function saveStaffAvailability(context: AuthorizedBusinessContext, staffId: string, input: unknown, expectedToken?: string, session?: AuthenticatedSession) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  if (!await prisma.staff.findFirst({ where: { id: staffId, businessId }, select: { id: true } })) throw notFound();
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const rules = parseAvailabilityRules(input, business.timezone);
  const weekly = rules.weekly.flatMap(day => day.intervals.map(hours => ({ businessId, staffId, weekday: day.weekday, startLocal: hours.startLocal, endLocal: hours.endLocal })));
  const overrides = rules.overrides.map(day => ({ businessId, staffId, date: new Date(`${day.date}T00:00:00.000Z`), isOpen: day.isOpen, startLocal: day.isOpen ? day.startLocal! : null, endLocal: day.isOpen ? day.endLocal! : null }));
  await withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    await assertSafeSchedule(tx, businessId, rules, staffId, expectedToken);
    await tx.staffWeeklyAvailability.deleteMany({ where: { businessId, staffId } });
    await tx.staffScheduleOverride.deleteMany({ where: { businessId, staffId } });
    if (weekly.length) await tx.staffWeeklyAvailability.createMany({ data: weekly });
    if (overrides.length) await tx.staffScheduleOverride.createMany({ data: overrides });
  });
  return { saved: true };
}

export async function getStaffAvailability(context: AuthorizedBusinessContext, staffId: string) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  if (!await prisma.staff.findFirst({ where: { id: staffId, businessId }, select: { id: true } })) throw notFound();
  const [weekly, overrides] = await Promise.all([
    prisma.staffWeeklyAvailability.findMany({ where: { businessId, staffId }, orderBy: [{ weekday: 'asc' }, { startLocal: 'asc' }] }),
    prisma.staffScheduleOverride.findMany({ where: { businessId, staffId }, orderBy: { date: 'asc' } }),
  ]);
  return { weekly, overrides };
}

export async function updateBusinessStaff(context: AuthorizedBusinessContext, staffId: string, input: { displayName?: string | undefined; active?: boolean | undefined; parallelCapacity?: number | undefined; serviceIds?: string[] | undefined }) {
  await validateBusinessContext(context, managers);
  input = z.strictObject({ displayName: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional(), parallelCapacity: z.number().int().min(1).max(100).optional(), serviceIds: z.array(z.string().min(1)).max(100).optional() }).refine(v => Object.keys(v).length > 0).parse(input);
  const businessId = context.businessId;
  try {
    const result = await withBusinessConfiguration(context, async tx => {
      await tx.$queryRaw`SELECT id FROM "Staff" WHERE id = ${staffId} AND "businessId" = ${businessId} FOR UPDATE`;
      const existing = await tx.staff.findFirst({ where: { id: staffId, businessId } }); if (!existing) throw notFound();
      const serviceIds = input.serviceIds;
      if (serviceIds && (new Set(serviceIds).size !== serviceIds.length || await tx.service.count({ where: { businessId, id: { in: serviceIds }, active: true } }) !== serviceIds.length)) throw new AppError(400, 'VALIDATION_ERROR', 'Choose active services from this business.');
      // Deactivating a resource/removing assignments invalidates only its pending
      // allocations; confirmed bookings and immutable snapshots remain intact.
      const holdWhere = { businessId, staffId, status: 'HELD' as const, ...(input.active === false ? {} : serviceIds ? { serviceId: { notIn: serviceIds } } : { id: '__no_hold__' }) };
      const expired = input.active === false || serviceIds ? await tx.booking.findMany({ where: holdWhere, select: { id: true, customerId: true } }) : [];
      if (expired.length) await tx.booking.updateMany({ where: holdWhere, data: { status: 'EXPIRED', holdExpiresAt: null } });
      const staff = await tx.staff.update({ where: { id: staffId, businessId }, data: { displayName: input.displayName ?? existing.displayName, ...(input.active !== undefined ? { active: input.active } : {}), ...(input.parallelCapacity !== undefined ? { parallelCapacity: input.parallelCapacity } : {}) }, select: staffProjection });
      if (serviceIds) {
        await tx.staffService.deleteMany({ where: { businessId, staffId, serviceId: { notIn: serviceIds } } });
        if (serviceIds.length) await tx.staffService.createMany({ data: serviceIds.map(serviceId => ({ businessId, staffId, serviceId })), skipDuplicates: true });
      }
      return { staff, expired };
    });
    await Promise.allSettled(result.expired.flatMap(h => h.customerId ? [releaseHold(h.id, h.customerId)] : []));
    return result.staff;
  } catch (error) { if (isDatabaseCapacityError(error)) throw conflict('Capacity cannot be lower than existing appointments or active holds.'); throw error; }
}

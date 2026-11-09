import { assertSafeSchedule, fenceScheduleSession } from './ScheduleImpact.service.js';
import type { AuthenticatedSession } from '../security/sessions.js';
import { withBusinessConfiguration } from './publication.js';
import { changingAgenda, MAX_REPORTED_CONFLICTS } from './TimeBlocks.service.js';
import { prisma } from '../db/client.js';
import { signalAgendaChanged } from '../infra/live-signals.js';
import { DEFAULT_BOOKING_POLICY, parseAvailabilityRules, parseBookingPolicy } from '../scheduling/rules.js';
import { AppError, notFound } from '../http/errors.js';
import { conflict } from '../http/errors.js';
import { isDatabaseCapacityError } from '../scheduling/booking-transaction.js';
import { releaseHold } from '../scheduling/reservations.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import { env } from '../env.js';

const managers = ['OWNER', 'MANAGER'] as const;
const staffProjection = { id: true, businessId: true, displayName: true, active: true, parallelCapacity: true } as const;
export type AvailabilityRules = {
  weekly: { weekday: number; intervals: { startLocal: string; endLocal: string }[] }[];
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

export const VERIFIED_PHONE_UNAVAILABLE = 'VERIFIED_PHONE_UNAVAILABLE';
// Without SMS delivery no customer can prove a phone, so the requirement would make the business unbookable (decisions.md, 2026-11-03 verified phone).
export async function saveBusinessPolicy(context: AuthorizedBusinessContext, input: PolicyInput, { phoneVerification = env.SMS_DELIVERY_MODE !== 'disabled' }: { phoneVerification?: boolean } = {}) {
  await validateBusinessContext(context, managers);
  input = parseBookingPolicy(input);
  if (input.requireVerifiedPhone && !phoneVerification) throw new AppError(409, VERIFIED_PHONE_UNAVAILABLE, 'Phone verification is not available yet, so customers could not meet this requirement.');
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
  return { weekly: await prisma.businessWeeklyAvailability.findMany({ where: { businessId: context.businessId }, orderBy: [{ weekday: 'asc' }, { startLocal: 'asc' }] }) };
}

export async function saveBusinessAvailability(context: AuthorizedBusinessContext, input: unknown, expectedToken?: string, session?: AuthenticatedSession) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  const rules = parseAvailabilityRules(input);
  const weekly = rules.weekly.flatMap(day => day.intervals.map(hours => ({ businessId, weekday: day.weekday, startLocal: hours.startLocal, endLocal: hours.endLocal })));
  await withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    await assertSafeSchedule(tx, businessId, rules, undefined, expectedToken);
    await tx.businessWeeklyAvailability.deleteMany({ where: { businessId } });
    if (weekly.length) await tx.businessWeeklyAvailability.createMany({ data: weekly });
  });
  return { saved: true, weeklyIntervals: weekly.length };
}

export async function listBusinessStaff(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  return { staff: await prisma.staff.findMany({ where: { businessId: context.businessId, archivedAt: null }, select: { ...staffProjection, services: { include: { service: { select: { id: true, name: true } } } } }, orderBy: { displayName: 'asc' } }) };
}

export async function createBusinessStaff(context: AuthorizedBusinessContext, input: { displayName: string; serviceIds: string[]; parallelCapacity?: number | undefined; creationKey?: string | undefined }) {
  await validateBusinessContext(context, managers);
  input = z.strictObject({ displayName: z.string().trim().min(2).max(120), serviceIds: z.array(z.string().min(1)).min(1).max(100), parallelCapacity: z.number().int().min(1).max(100).optional(), creationKey: z.string().uuid().optional() }).parse(input);
  const businessId = context.businessId;
  const ids = [...new Set(input.serviceIds)];
  if (!ids.length || ids.length !== input.serviceIds.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Every selected service must be active in this business.');
  }
  return changingAgenda(context, async tx => {
    const creationFingerprint = input.creationKey ? createHash('sha256').update(JSON.stringify([input.displayName, input.parallelCapacity ?? 1, [...ids].sort()])).digest('hex') : null;
    if (input.creationKey) {
      const prior = await tx.staff.findUnique({ where: { businessId_creationKey: { businessId, creationKey: input.creationKey } } });
      if (prior) { if (prior.creationFingerprint !== creationFingerprint) throw conflict('This staff request was already used for different details.'); if (prior.archivedAt) throw conflict('This staff member was removed. Add them again with a new request.'); const { creationKey: _key, creationFingerprint: _fingerprint, ...fields } = prior; return fields; }
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
  if (!await prisma.staff.findFirst({ where: { id: staffId, businessId, archivedAt: null }, select: { id: true } })) throw notFound();
  const rules = parseAvailabilityRules(input);
  const weekly = rules.weekly.flatMap(day => day.intervals.map(hours => ({ businessId, staffId, weekday: day.weekday, startLocal: hours.startLocal, endLocal: hours.endLocal })));
  await withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    await assertSafeSchedule(tx, businessId, rules, staffId, expectedToken);
    await tx.staffWeeklyAvailability.deleteMany({ where: { businessId, staffId } });
    if (weekly.length) await tx.staffWeeklyAvailability.createMany({ data: weekly });
  });
  return { saved: true };
}

export async function getStaffAvailability(context: AuthorizedBusinessContext, staffId: string) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  if (!await prisma.staff.findFirst({ where: { id: staffId, businessId, archivedAt: null }, select: { id: true } })) throw notFound();
  return { weekly: await prisma.staffWeeklyAvailability.findMany({ where: { businessId, staffId }, orderBy: [{ weekday: 'asc' }, { startLocal: 'asc' }] }) };
}

export async function updateBusinessStaff(context: AuthorizedBusinessContext, staffId: string, input: { displayName?: string | undefined; active?: boolean | undefined; parallelCapacity?: number | undefined; serviceIds?: string[] | undefined }) {
  await validateBusinessContext(context, managers);
  input = z.strictObject({ displayName: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional(), parallelCapacity: z.number().int().min(1).max(100).optional(), serviceIds: z.array(z.string().min(1)).max(100).optional() }).refine(v => Object.keys(v).length > 0).parse(input);
  const businessId = context.businessId;
  try {
    const result = await changingAgenda(context, async tx => {
      await tx.$queryRaw`SELECT id FROM "Staff" WHERE id = ${staffId} AND "businessId" = ${businessId} FOR UPDATE`;
      const existing = await tx.staff.findFirst({ where: { id: staffId, businessId, archivedAt: null } }); if (!existing) throw notFound();
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

export const STAFF_HAS_APPOINTMENTS = 'STAFF_HAS_APPOINTMENTS';

export async function removeBusinessStaff(context: AuthorizedBusinessContext, staffId: string, session?: AuthenticatedSession, now = new Date()) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  const result = await withBusinessConfiguration(context, async tx => {
    await fenceScheduleSession(tx, session);
    await tx.$queryRaw`SELECT id FROM "Staff" WHERE id = ${staffId} AND "businessId" = ${businessId} FOR UPDATE`;
    if (!await tx.staff.findFirst({ where: { id: staffId, businessId, archivedAt: null }, select: { id: true } })) throw notFound();
    // Removal never cancels: there is no email delivery yet, so a customer would arrive for a cancelled appointment.
    const upcoming = { businessId, staffId, status: 'CONFIRMED' as const, occupiedUntil: { gt: now } };
    const [total, rows] = await Promise.all([
      tx.booking.count({ where: upcoming }),
      tx.booking.findMany({ where: upcoming, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: MAX_REPORTED_CONFLICTS, select: { id: true, startsAt: true, endsAt: true, customerName: true, serviceName: true, staff: { select: { displayName: true } } } }),
    ]);
    if (total) throw new AppError(409, STAFF_HAS_APPOINTMENTS, 'This staff member has upcoming appointments. Move or cancel them first.', undefined, { total, timezone: (await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } })).timezone, conflicts: rows.map(row => ({ kind: 'APPOINTMENT' as const, id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, staffName: row.staff.displayName, customerName: row.customerName, serviceName: row.serviceName })) });
    // Any booking row, even a cancelled or expired one, holds a restrictive foreign key to its staff member.
    if (!await tx.booking.count({ where: { businessId, staffId } })) {
      await tx.staff.delete({ where: { id: staffId, businessId } });
      return { deleted: true, archived: false, expired: [] };
    }
    const held = { businessId, staffId, status: 'HELD' as const };
    const expired = await tx.booking.findMany({ where: held, select: { id: true, customerId: true } });
    if (expired.length) await tx.booking.updateMany({ where: held, data: { status: 'EXPIRED', holdExpiresAt: null } });
    await tx.staffService.deleteMany({ where: { businessId, staffId } });
    await tx.timeBlock.deleteMany({ where: { businessId, staffId } });
    await tx.staff.update({ where: { id: staffId, businessId }, data: { active: false, archivedAt: now } });
    return { deleted: false, archived: true, expired };
  });
  signalAgendaChanged(businessId);
  await Promise.allSettled(result.expired.flatMap(h => h.customerId ? [releaseHold(h.id, h.customerId)] : []));
  return { deleted: result.deleted, archived: result.archived };
}

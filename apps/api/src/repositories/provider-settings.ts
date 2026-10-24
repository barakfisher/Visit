import { prisma } from '../db/client.js';
import { AppError, notFound } from '../http/errors.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';

const managers = ['OWNER', 'MANAGER'] as const;
export type AvailabilityRules = {
  weekly: { weekday: number; intervals: { startLocal: string; endLocal: string }[] }[];
  overrides: { date: string; isOpen: boolean; startLocal?: string | undefined; endLocal?: string | undefined }[];
};
export type PolicyInput = {
  minimumNoticeMinutes: number; maximumAdvanceDays: number;
  bufferBeforeMinutes: number; bufferAfterMinutes: number;
  cancellationCutoffMinutes: number; rescheduleCutoffMinutes: number;
};

export async function getBusinessSettings(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context);
  const business = await prisma.business.findUnique({ where: { id: context.businessId }, select: { id: true, name: true, slug: true, timezone: true, approvalStatus: true } });
  if (!business) throw notFound();
  return { business, role: context.role };
}

export async function getBusinessPolicy(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  return { policy: await prisma.bookingPolicy.findUnique({ where: { businessId: context.businessId } }) };
}

export async function saveBusinessPolicy(context: AuthorizedBusinessContext, input: PolicyInput) {
  await validateBusinessContext(context, managers);
  const data = {
    minimumNoticeMinutes: input.minimumNoticeMinutes, maximumAdvanceDays: input.maximumAdvanceDays,
    bufferBeforeMinutes: input.bufferBeforeMinutes, bufferAfterMinutes: input.bufferAfterMinutes,
    cancellationCutoffMinutes: input.cancellationCutoffMinutes, rescheduleCutoffMinutes: input.rescheduleCutoffMinutes,
  };
  return prisma.bookingPolicy.upsert({ where: { businessId: context.businessId }, create: { ...data, businessId: context.businessId }, update: data });
}

export async function getBusinessAvailability(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  const [weekly, overrides] = await Promise.all([
    prisma.businessWeeklyAvailability.findMany({ where: { businessId: context.businessId }, orderBy: [{ weekday: 'asc' }, { startLocal: 'asc' }] }),
    prisma.scheduleOverride.findMany({ where: { businessId: context.businessId }, orderBy: { date: 'asc' } }),
  ]);
  return { weekly, overrides };
}

export async function saveBusinessAvailability(context: AuthorizedBusinessContext, input: AvailabilityRules) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  const weekly = input.weekly.flatMap(day => day.intervals.map(hours => ({ businessId, weekday: day.weekday, startLocal: hours.startLocal, endLocal: hours.endLocal })));
  const overrides = input.overrides.map(day => ({ businessId, date: new Date(`${day.date}T00:00:00.000Z`), isOpen: day.isOpen, startLocal: day.isOpen ? day.startLocal! : null, endLocal: day.isOpen ? day.endLocal! : null }));
  await prisma.$transaction(async tx => {
    await tx.businessWeeklyAvailability.deleteMany({ where: { businessId } });
    await tx.scheduleOverride.deleteMany({ where: { businessId } });
    if (weekly.length) await tx.businessWeeklyAvailability.createMany({ data: weekly });
    if (overrides.length) await tx.scheduleOverride.createMany({ data: overrides });
  });
  return { saved: true, weeklyIntervals: weekly.length, overrides: overrides.length };
}

export async function listBusinessStaff(context: AuthorizedBusinessContext) {
  await validateBusinessContext(context, managers);
  return { staff: await prisma.staff.findMany({ where: { businessId: context.businessId }, include: { services: { include: { service: { select: { id: true, name: true } } } } }, orderBy: { displayName: 'asc' } }) };
}

export async function createBusinessStaff(context: AuthorizedBusinessContext, input: { displayName: string; serviceIds: string[] }) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  const ids = [...new Set(input.serviceIds)];
  if (!ids.length || ids.length !== input.serviceIds.length || await prisma.service.count({ where: { businessId, id: { in: ids }, active: true } }) !== ids.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Every selected service must be active in this business.');
  }
  return prisma.$transaction(async tx => {
    const staff = await tx.staff.create({ data: { businessId, displayName: input.displayName, parallelCapacity: 1 } });
    await tx.staffService.createMany({ data: ids.map(serviceId => ({ businessId, staffId: staff.id, serviceId })) });
    return staff;
  });
}

export async function saveStaffAvailability(context: AuthorizedBusinessContext, staffId: string, input: AvailabilityRules) {
  await validateBusinessContext(context, managers);
  const businessId = context.businessId;
  if (!await prisma.staff.findFirst({ where: { id: staffId, businessId }, select: { id: true } })) throw notFound();
  const weekly = input.weekly.flatMap(day => day.intervals.map(hours => ({ businessId, staffId, weekday: day.weekday, startLocal: hours.startLocal, endLocal: hours.endLocal })));
  const overrides = input.overrides.map(day => ({ businessId, staffId, date: new Date(`${day.date}T00:00:00.000Z`), isOpen: day.isOpen, startLocal: day.isOpen ? day.startLocal! : null, endLocal: day.isOpen ? day.endLocal! : null }));
  await prisma.$transaction(async tx => {
    await tx.staffWeeklyAvailability.deleteMany({ where: { businessId, staffId } });
    await tx.staffScheduleOverride.deleteMany({ where: { businessId, staffId } });
    if (weekly.length) await tx.staffWeeklyAvailability.createMany({ data: weekly });
    if (overrides.length) await tx.staffScheduleOverride.createMany({ data: overrides });
  });
  return { saved: true };
}

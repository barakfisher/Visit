import { releaseHold } from '../scheduling/reservations.js';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { Temporal } from '@js-temporal/polyfill';
import { prisma } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { validateBusinessContext, type AuthorizedBusinessContext } from '../security/tenant-context.js';
import { effectiveWindows } from '../scheduling/rules.js';
import { workingWindows } from '../scheduling/availability.js';
export async function publicationReadiness(tx: Prisma.TransactionClient, businessId: string) {
  const business = await tx.business.findUnique({ where: { id: businessId }, include: { bookingPolicy: true, weeklyAvailability: true, scheduleOverrides: true, services: { where: { active: true }, include: { staff: { where: { staff: { active: true } }, include: { staff: { include: { availability: true, overrides: true } } } } } } } });
  if (!business) throw notFound();
  const blockers: Record<string, string> = {};
  if (business.deletedAt) blockers.business = 'BUSINESS_UNAVAILABLE';
  if (business.approvalStatus !== 'APPROVED') blockers.approval = 'ADMIN_APPROVAL_REQUIRED';
  if (business.timezone !== PILOT_TIMEZONE) blockers.timezone = 'ISRAEL_TIME_REVIEW_REQUIRED';
  if (business.name.trim().length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(business.slug) || !business.category.trim() || !business.location?.trim()) blockers.profile = 'COMPLETE_BUSINESS_PROFILE';
  if (!business.services.length) blockers.services = 'ACTIVE_SERVICE_REQUIRED';
  if (!business.bookingPolicy) blockers.policy = 'EXPLICIT_POLICY_REQUIRED';
  if (!business.weeklyAvailability.length && !business.scheduleOverrides.some(day => day.isOpen)) blockers.hours = 'WORKING_HOURS_REQUIRED';
  let calculationZone = business.timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: calculationZone }); } catch { calculationZone = PILOT_TIMEZONE; }
  const today = Temporal.Now.zonedDateTimeISO(calculationZone).toPlainDate();
  for (const service of business.services) {
    if (!service.staff.length) { blockers[`services.${service.id}.staff`] = 'ASSIGNED_ACTIVE_STAFF_REQUIRED'; continue; }
    let fits = false;
    const bufferBefore = (business.bookingPolicy?.bufferBeforeMinutes ?? 0) * 60000;
    const requiredAfterStart = (service.durationMinutes + (business.bookingPolicy?.bufferAfterMinutes ?? 0)) * 60000;
    const earliestNotice = Date.now() + (business.bookingPolicy?.minimumNoticeMinutes ?? 0) * 60000;
    if (!blockers.hours) for (let offset = 0; offset <= Math.min(730, business.bookingPolicy?.maximumAdvanceDays ?? 60) && !fits; offset++) {
      const date = today.add({ days: offset }), key = date.toString(), weekday = date.dayOfWeek % 7;
      const businessHours = effectiveWindows(business.scheduleOverrides.find(d => d.date.toISOString().slice(0, 10) === key) ?? null, business.weeklyAvailability.filter(d => d.weekday === weekday));
      if (!businessHours.length) continue;
      for (const { staff } of service.staff) {
        const staffHours = effectiveWindows(staff.overrides.find(d => d.date.toISOString().slice(0, 10) === key) ?? null, staff.availability.length ? staff.availability.filter(d => d.weekday === weekday) : businessHours);
        const windows = workingWindows(key, calculationZone, businessHours, staffHours).intervals;
        if (windows.some(w => {
          const opening = w.startsAt.getTime();
          const earliest = Math.max(opening + bufferBefore, earliestNotice);
          const candidate = opening + Math.ceil((earliest - opening) / 900000) * 900000; // Same 15-minute grid as availability.
          return w.endsAt.getTime() - candidate >= requiredAfterStart;
        })) { fits = true; break; }
      }
    }
    if (!fits) blockers[`services.${service.id}.hours`] = 'SERVICE_AND_BUFFERS_MUST_FIT_HOURS';
  }
  return { ready: !Object.keys(blockers).length, blockers, publishedAt: business.publishedAt, state: business.publishedAt ? 'PUBLISHED' : business.approvalStatus === 'APPROVED' ? 'APPROVED' : 'DRAFT' };
}
export async function lockBusinessConfiguration(tx: Prisma.TransactionClient, context: AuthorizedBusinessContext) {
  await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${context.businessId} FOR UPDATE`;
  const membership = await tx.membership.findFirst({ where: { businessId: context.businessId, identityId: context.identityId, role: { in: ['OWNER', 'MANAGER'] }, status: 'ACTIVE', business: { approvalStatus: 'APPROVED' } } });
  if (!membership) throw forbidden();
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Membership" WHERE "businessId" = ${context.businessId} AND "identityId" = ${context.identityId} AND status = 'ACTIVE' AND role IN ('OWNER','MANAGER') FOR SHARE`;
  if (!locked.length) throw forbidden();
}
async function expireBusinessHolds(tx: Prisma.TransactionClient, businessId: string) {
  const holds = await tx.booking.findMany({ where: { businessId, status: 'HELD' }, select: { id: true, customerId: true } });
  await tx.booking.updateMany({ where: { businessId, status: 'HELD' }, data: { status: 'EXPIRED', holdExpiresAt: null } });
  return holds;
}
async function releaseExpired(holds: { id: string; customerId: string }[]) {
  await Promise.allSettled(holds.map(hold => releaseHold(hold.id, hold.customerId)));
}
export async function withBusinessConfiguration<T>(context: AuthorizedBusinessContext, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  const result = await prisma.$transaction(async tx => {
    await lockBusinessConfiguration(tx, context);
    const value = await work(tx);
    const current = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { publishedAt: true } });
    let expired: { id: string; customerId: string }[] = [];
    if (current.publishedAt && Object.keys((await publicationReadiness(tx, context.businessId)).blockers).some(field => !['profile', 'timezone'].includes(field))) {
      await tx.business.update({ where: { id: context.businessId }, data: { publishedAt: null } });
      expired = await expireBusinessHolds(tx, context.businessId);
    }
    return { value, expired };
  }, { maxWait: 5000, timeout: 15000 });
  await releaseExpired(result.expired);
  return result.value;
}
export async function setPublication(context: AuthorizedBusinessContext, published: boolean) {
  await validateBusinessContext(context, ['OWNER', 'MANAGER']);
  const result = await prisma.$transaction(async tx => {
    await lockBusinessConfiguration(tx, context);
    const readiness = await publicationReadiness(tx, context.businessId);
    if (published && !readiness.ready) throw new AppError(409, 'BUSINESS_NOT_READY', 'Complete the publishing checklist.', readiness.blockers);
    const business = await tx.business.update({ where: { id: context.businessId }, data: { publishedAt: published ? readiness.publishedAt ?? new Date() : null }, select: { id: true, publishedAt: true } });
    return { value: { ...business, state: business.publishedAt ? 'PUBLISHED' : 'APPROVED' }, expired: published ? [] : await expireBusinessHolds(tx, context.businessId) };
  }, { maxWait: 5000, timeout: 15000 });
  await releaseExpired(result.expired);
  return result.value;
}

import { Temporal } from '@js-temporal/polyfill';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict } from '../http/errors.js';
import type { Interval } from './intervals.js';
import { containsInterval, workingWindows } from './availability.js';
import { effectiveWindows } from './rules.js';

export async function assertWorkingHours(businessId: string, timezone: string, staffId: string, startsAt: Date, occupied: Interval, db: Prisma.TransactionClient = prisma) {
  const zonedStart = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(timezone);
  const localDate = zonedStart.toPlainDate();
  const weekday = zonedStart.dayOfWeek % 7;
  const dateKey = localDate.toString();
  const [businessOverride, businessHours, staffOverride, staffHours] = await Promise.all([
    db.scheduleOverride.findFirst({ where: { businessId, date: new Date(`${dateKey}T00:00:00.000Z`) } }),
    db.businessWeeklyAvailability.findMany({ where: { businessId, weekday } }),
    db.staffScheduleOverride.findFirst({ where: { businessId, staffId, date: new Date(`${dateKey}T00:00:00.000Z`) } }),
    db.staffWeeklyAvailability.findMany({ where: { businessId, staffId } }),
  ]);
  const businessWindows = effectiveWindows(businessOverride, businessHours);
  const staffWindows = effectiveWindows(staffOverride, staffHours.length ? staffHours.filter((item) => item.weekday === weekday) : businessWindows);
  const shared = workingWindows(dateKey, timezone, businessWindows, staffWindows);
  if (!containsInterval(shared.intervals, occupied)) throw conflict('The appointment and its buffers must fit inside business and provider working hours.');
}


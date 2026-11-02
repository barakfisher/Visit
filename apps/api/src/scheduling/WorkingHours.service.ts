import { Temporal } from '@js-temporal/polyfill';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict } from '../http/errors.js';
import type { Interval } from './intervals.js';
import { containsInterval, workingWindows } from './availability.js';

export async function assertWorkingHours(businessId: string, timezone: string, staffId: string, startsAt: Date, occupied: Interval, db: Prisma.TransactionClient = prisma) {
  const zonedStart = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(timezone);
  const localDate = zonedStart.toPlainDate();
  const weekday = zonedStart.dayOfWeek % 7;
  const dateKey = localDate.toString();
  const [businessWindows, staffHours] = await Promise.all([
    db.businessWeeklyAvailability.findMany({ where: { businessId, weekday } }),
    db.staffWeeklyAvailability.findMany({ where: { businessId, staffId } }),
  ]);
  const staffWindows = staffHours.length ? staffHours.filter((item) => item.weekday === weekday) : businessWindows;
  const shared = workingWindows(dateKey, timezone, businessWindows, staffWindows);
  if (!containsInterval(shared.intervals, occupied)) throw conflict('The appointment and its buffers must fit inside business and provider working hours.');
}


import { Temporal } from '@js-temporal/polyfill';
import { possibleLocalInstants } from './local-time.js';
import { assertCapacity, maximumConcurrentBookings, occupiedInterval, type Interval } from './intervals.js';

export type LocalWindow = Readonly<{ startLocal: string; endLocal: string }>;
export type AvailabilityReason = 'OUTSIDE_WORKING_HOURS' | 'MINIMUM_NOTICE' | 'OUTSIDE_BOOKING_HORIZON' | 'MANUAL_BLOCK' | 'CAPACITY_FULL' | 'TEMPORARY_HOLD';
export type ScheduleWarning = { code: 'NONEXISTENT_SCHEDULE_BOUNDARY' | 'AMBIGUOUS_SCHEDULE_BOUNDARY'; scope: 'business' | 'staff'; staffId?: string };
export type Occupancy = Interval & { status: 'CONFIRMED' | 'HELD' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED' | 'NO_SHOW'; holdExpiresAt: Date | null };
export type AvailabilityStaff = { id: string; displayName: string; parallelCapacity: number; windows: readonly LocalWindow[]; bookings: readonly Occupancy[]; blocks: readonly Interval[] };
export type AvailabilityPolicy = { minimumNoticeMinutes: number; maximumAdvanceDays: number; bufferBeforeMinutes: number; bufferAfterMinutes: number };
export type AvailabilitySlot = { startsAt: string; endsAt: string; occupiedFrom: string; occupiedUntil: string; localTime: string; utcOffset: string; staffId: string; staffName: string; available: boolean; locked: boolean; remainingCapacity: number; reasons: AvailabilityReason[] };

export function mergeWindows(windows: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    if (!Number.isFinite(interval.startsAt.getTime()) || !Number.isFinite(interval.endsAt.getTime()) || interval.endsAt <= interval.startsAt) throw new RangeError('Working windows must be positive, valid intervals.');
    const prior = result[result.length - 1];
    if (prior && interval.startsAt <= prior.endsAt) result[result.length - 1] = { startsAt: prior.startsAt, endsAt: new Date(Math.max(prior.endsAt.getTime(), interval.endsAt.getTime())) };
    else result.push(interval);
  }
  return result;
}

// A recurring boundary on a clock transition must resolve uniquely. Never silently
// shift a nonexistent opening or guess which occurrence of a repeated hour to use.
export function resolveWorkingWindows(date: string, timezone: string, windows: readonly LocalWindow[]) {
  const intervals: Interval[] = [];
  const warnings = new Set<ScheduleWarning['code']>();
  const normalized: LocalWindow[] = [];
  for (const hours of [...windows].sort((a, b) => a.startLocal.localeCompare(b.startLocal))) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hours.startLocal) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hours.endLocal) || hours.startLocal >= hours.endLocal) throw new RangeError('Working hours must be increasing same-day HH:mm intervals.');
    const prior = normalized[normalized.length - 1];
    if (prior && hours.startLocal <= prior.endLocal) normalized[normalized.length - 1] = { startLocal: prior.startLocal, endLocal: hours.endLocal > prior.endLocal ? hours.endLocal : prior.endLocal };
    else normalized.push(hours);
  }
  for (const hours of normalized) {
    const starts = possibleLocalInstants(date, hours.startLocal, timezone);
    const ends = possibleLocalInstants(date, hours.endLocal, timezone);
    if (starts.length !== 1 || ends.length !== 1) {
      warnings.add(!starts.length || !ends.length ? 'NONEXISTENT_SCHEDULE_BOUNDARY' : 'AMBIGUOUS_SCHEDULE_BOUNDARY');
      continue;
    }
    intervals.push({ startsAt: starts[0]!, endsAt: ends[0]! });
  }
  return { intervals: mergeWindows(intervals), warnings: [...warnings] };
}

export function intersectWindows(business: readonly Interval[], staff: readonly Interval[]) {
  return mergeWindows(business.flatMap(a => staff.flatMap(b => {
    const startsAt = new Date(Math.max(a.startsAt.getTime(), b.startsAt.getTime()));
    const endsAt = new Date(Math.min(a.endsAt.getTime(), b.endsAt.getTime()));
    return startsAt < endsAt ? [{ startsAt, endsAt }] : [];
  })));
}
export const containsInterval = (windows: readonly Interval[], occupied: Interval) => windows.some(window => occupied.startsAt >= window.startsAt && occupied.endsAt <= window.endsAt);

export function workingWindows(date: string, timezone: string, business: readonly LocalWindow[], staff: readonly LocalWindow[]) {
  const a = resolveWorkingWindows(date, timezone, business), b = resolveWorkingWindows(date, timezone, staff);
  return { intervals: intersectWindows(a.intervals, b.intervals), businessWarnings: a.warnings, staffWarnings: b.warnings };
}

function clipped(intervals: readonly Interval[], candidate: Interval) {
  return intervals.filter(item => item.startsAt < candidate.endsAt && item.endsAt > candidate.startsAt).map(item => ({ startsAt: new Date(Math.max(item.startsAt.getTime(), candidate.startsAt.getTime())), endsAt: new Date(Math.min(item.endsAt.getTime(), candidate.endsAt.getTime())) }));
}

export function evaluateCandidate(input: { startsAt: Date; durationMinutes: number; timezone: string; now: Date; policy: AvailabilityPolicy; staff: AvailabilityStaff; windows: readonly Interval[] }) {
  const { startsAt, durationMinutes, timezone, now, policy, staff, windows } = input;
  if (!Number.isInteger(staff.parallelCapacity) || staff.parallelCapacity < 1) throw new RangeError('Staff capacity must be a positive integer.');
  const occupied = occupiedInterval(startsAt, durationMinutes, policy.bufferBeforeMinutes, policy.bufferAfterMinutes);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
  const zoned = Temporal.Instant.from(startsAt.toISOString()).toZonedDateTimeISO(timezone);
  const horizon = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone).toPlainDate().add({ days: policy.maximumAdvanceDays });
  const reasons: AvailabilityReason[] = [];
  if (!containsInterval(windows, occupied)) reasons.push('OUTSIDE_WORKING_HOURS');
  if (startsAt.getTime() < now.getTime() + policy.minimumNoticeMinutes * 60000) reasons.push('MINIMUM_NOTICE');
  if (Temporal.PlainDate.compare(zoned.toPlainDate(), horizon) > 0) reasons.push('OUTSIDE_BOOKING_HORIZON');
  if (staff.blocks.some(block => block.startsAt < occupied.endsAt && block.endsAt > occupied.startsAt)) reasons.push('MANUAL_BLOCK');
  const active = staff.bookings.filter(booking => ['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(booking.status) || (booking.status === 'HELD' && booking.holdExpiresAt !== null && booking.holdExpiresAt > now));
  const existing = clipped(active, occupied);
  const remainingCapacity = Math.max(0, staff.parallelCapacity - maximumConcurrentBookings(existing));
  if (!remainingCapacity) {
    reasons.push('CAPACITY_FULL');
    if (assertCapacity(occupied, clipped(active.filter(booking => ['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(booking.status)), occupied), staff.parallelCapacity)) reasons.push('TEMPORARY_HOLD');
  }
  return {
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), occupiedFrom: occupied.startsAt.toISOString(), occupiedUntil: occupied.endsAt.toISOString(),
    localTime: zoned.toPlainTime().toString({ smallestUnit: 'minute' }), utcOffset: zoned.offset, staffId: staff.id, staffName: staff.displayName,
    available: reasons.length === 0, locked: reasons.includes('TEMPORARY_HOLD') && reasons.every(reason => reason === 'CAPACITY_FULL' || reason === 'TEMPORARY_HOLD'),
    remainingCapacity, reasons,
  } satisfies AvailabilitySlot;
}

export function generateAvailability(input: { date: string; timezone: string; now: Date; durationMinutes: number; policy: AvailabilityPolicy; businessWindows: readonly LocalWindow[]; staff: readonly AvailabilityStaff[]; includeUnavailable?: boolean }) {
  const { date, timezone, now, durationMinutes, policy } = input;
  const requestedDate = Temporal.PlainDate.from(date);
  const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone).toPlainDate();
  // Past days and days beyond the local-date horizon have no selectable candidates.
  if (Temporal.PlainDate.compare(requestedDate, today) < 0 || Temporal.PlainDate.compare(requestedDate, today.add({ days: policy.maximumAdvanceDays })) > 0) return { slots: [] as AvailabilitySlot[], warnings: [] as ScheduleWarning[] };
  const business = resolveWorkingWindows(date, timezone, input.businessWindows);
  const slots: AvailabilitySlot[] = [], warnings: ScheduleWarning[] = business.warnings.map(code => ({ code, scope: 'business' }));
  const unique = new Set<string>();
  for (const staff of input.staff) {
    const resolved = resolveWorkingWindows(date, timezone, staff.windows);
    const shared = { intervals: intersectWindows(business.intervals, resolved.intervals) };
    for (const code of resolved.warnings) warnings.push({ code, scope: 'staff', staffId: staff.id });
    for (const window of shared.intervals) {
      // Advance on the absolute timeline: DST gaps are absent and folds have two
      // independently bookable instants with different offsets, never duplicate keys.
      for (let at = window.startsAt.getTime(); at < window.endsAt.getTime(); at += 15 * 60000) {
        const startsAt = new Date(at);
        const slot = evaluateCandidate({ startsAt, durationMinutes, timezone, now, policy, staff, windows: shared.intervals });
        if (!input.includeUnavailable && !slot.available) continue;
        const key = `${staff.id}:${slot.startsAt}`;
        if (!unique.has(key)) { unique.add(key); slots.push(slot); }
      }
    }
  }
  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId));
  return { slots, warnings };
}

export type Interval = Readonly<{ startsAt: Date; endsAt: Date }>;

export function occupiedInterval(
  startsAt: Date,
  durationMinutes: number,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
): Interval {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) throw new RangeError('Service duration must be a positive whole number of minutes.');
  if (![bufferBeforeMinutes, bufferAfterMinutes].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new RangeError('Booking buffers must be non-negative whole numbers of minutes.');
  }
  if (!Number.isFinite(startsAt.getTime())) throw new RangeError('Start must be a valid timestamp.');
  const from = startsAt.getTime() - bufferBeforeMinutes * 60_000;
  const until = startsAt.getTime() + (durationMinutes + bufferAfterMinutes) * 60_000;
  if (!Number.isFinite(new Date(from).getTime()) || !Number.isFinite(new Date(until).getTime())) throw new RangeError('Occupied range exceeds valid timestamp bounds.');
  return { startsAt: new Date(from), endsAt: new Date(until) };
}

export function maximumConcurrentBookings(intervals: readonly Interval[]) {
  const events: { at: number; delta: -1 | 1 }[] = [];
  for (const interval of intervals) {
    const from = interval.startsAt.getTime();
    const until = interval.endsAt.getTime();
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
      throw new RangeError('Booking intervals must have valid timestamps and positive duration.');
    }
    events.push({ at: from, delta: 1 }, { at: until, delta: -1 });
  }
  // End events sort first at equal timestamps: [start, end) allows adjacent visits.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    active += event.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export function assertCapacity(candidate: Interval, existing: readonly Interval[], capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Staff capacity must be a positive whole number.');
  const relevant = existing.filter((interval) => interval.startsAt < candidate.endsAt && interval.endsAt > candidate.startsAt);
  if (maximumConcurrentBookings([...relevant, candidate]) > capacity) return false;
  return true;
}

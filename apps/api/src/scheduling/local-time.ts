import { Temporal } from '@js-temporal/polyfill';

export function possibleLocalInstants(date: string, time: string, timezone: string) {
  const local = Temporal.PlainDateTime.from(`${date}T${time}`);
  const earlier = local.toZonedDateTime(timezone, { disambiguation: 'earlier' });
  const later = local.toZonedDateTime(timezone, { disambiguation: 'later' });
  const sameLocal = (value: Temporal.ZonedDateTime) => value.toPlainDateTime().toString({ smallestUnit: 'minute' }) === local.toString({ smallestUnit: 'minute' });
  if (!sameLocal(earlier) || !sameLocal(later)) return [];
  return earlier.epochNanoseconds === later.epochNanoseconds ? [new Date(Number(earlier.epochMilliseconds))] : [earlier, later].map((value) => new Date(Number(value.epochMilliseconds)));
}

export function localDateTimeToInstant(date: string, time: string, timezone: string, offset?: string) {
  const local = Temporal.PlainDateTime.from(`${date}T${time}`);
  const earlier = local.toZonedDateTime(timezone, { disambiguation: 'earlier' });
  const later = local.toZonedDateTime(timezone, { disambiguation: 'later' });
  const unique = earlier.epochNanoseconds === later.epochNanoseconds;
  const sameLocal = (value: Temporal.ZonedDateTime) => value.toPlainDateTime().toString({ smallestUnit: 'minute' }) === local.toString({ smallestUnit: 'minute' });
  if (!sameLocal(earlier) || !sameLocal(later)) throw new RangeError('This local time does not exist because the clock moves forward.');
  if (!unique && !offset) throw new RangeError('This local time is ambiguous. Choose an explicit UTC offset.');
  if (!unique) {
    const match = [earlier, later].find((candidate) => candidate.offset === offset);
    if (!match) throw new RangeError('The selected UTC offset is not valid for this local time.');
    return new Date(Number(match.epochMilliseconds));
  }
  if (offset && earlier.offset !== offset) throw new RangeError('The selected UTC offset is not valid for this local time.');
  return new Date(Number(earlier.epochMilliseconds));
}

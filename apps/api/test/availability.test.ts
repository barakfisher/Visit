import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { generateAvailability, workingWindows, evaluateCandidate, type AvailabilityStaff, type Occupancy } from '../src/scheduling/availability.js';
import { occupiedInterval } from '../src/scheduling/intervals.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { getBusinessAvailability } from '../src/repositories/availability.js';
import { requirePublicBusiness } from '../src/security/tenant-context.js';
import { tokenDigest } from '../src/security/sessions.js';

const date = '2026-02-02', now = new Date('2026-02-01T00:00:00Z');
const hours = (startLocal = '09:00', endLocal = '17:00') => [{ startLocal, endLocal }];
const policy = { minimumNoticeMinutes: 0, maximumAdvanceDays: 730, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const staff = (input: Partial<AvailabilityStaff> = {}): AvailabilityStaff => ({ id: 'staff', displayName: 'Expert', parallelCapacity: 1, windows: hours(), bookings: [], blocks: [], ...input });
const at = (time: string) => new Date(`${date}T${time}:00Z`);
const occupied = (from: string, until: string, status: Occupancy['status'] = 'CONFIRMED', holdExpiresAt: Date | null = null): Occupancy => ({ startsAt: at(from), endsAt: at(until), status, holdExpiresAt });
const run = (input: Partial<Parameters<typeof generateAvailability>[0]> = {}) => generateAvailability({ date, timezone: 'UTC', now, durationMinutes: 30, policy, businessWindows: hours(), staff: [staff()], includeUnavailable: true, ...input });
const slot = (result: ReturnType<typeof run>, localTime: string, staffId = 'staff') => result.slots.find(item => item.localTime === localTime && item.staffId === staffId)!;

test('full service and buffers fit both business and staff windows', () => {
  const result = run({ policy: { ...policy, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }, staff: [staff({ windows: hours('10:00', '16:00') })] });
  assert.equal(slot(result, '10:00').available, false);
  assert.deepEqual(slot(result, '10:00').reasons, ['OUTSIDE_WORKING_HOURS']);
  assert.equal(slot(result, '10:15').available, true);
  assert.equal(slot(result, '15:15').available, true);
  assert.equal(slot(result, '15:30').available, false);
  assert.equal(slot(result, '10:15').occupiedFrom, `${date}T10:00:00.000Z`);
  assert.equal(slot(result, '10:15').occupiedUntil, `${date}T11:00:00.000Z`);
});
test('adjacent schedule windows merge while split breaks remain closed', () => {
  const adjacent = run({ businessWindows: [...hours('09:00', '12:00'), ...hours('12:00', '17:00')] });
  assert.equal(slot(adjacent, '11:45').available, true);
  const split = run({ businessWindows: [...hours('09:00', '12:00'), ...hours('13:00', '17:00')] });
  assert.equal(slot(split, '11:45').available, false);
  assert.equal(slot(split, '12:00'), undefined);
  assert.equal(slot(split, '13:00').available, true);
});
test('capacity counts peak overlap throughout the candidate rather than overlapping row count', () => {
  const sequential = [occupied('09:45', '10:15'), occupied('10:15', '10:45')];
  const result = run({ staff: [staff({ parallelCapacity: 2, bookings: sequential })] });
  assert.equal(slot(result, '10:00').available, true); assert.equal(slot(result, '10:00').remainingCapacity, 1);
  const full = run({ staff: [staff({ parallelCapacity: 2, bookings: [...sequential, occupied('10:20', '10:50')] })] });
  assert.equal(slot(full, '10:00').available, false); assert.deepEqual(slot(full, '10:00').reasons, ['CAPACITY_FULL']);
  assert.equal(slot(full, '11:00').available, true);
});
test('held occupancy expires exactly at its deadline, and inactive booking states never consume capacity', () => {
  const result = run({ staff: [staff({ bookings: [occupied('10:00', '10:30', 'HELD', now), occupied('10:00', '10:30', 'CANCELLED'), occupied('10:00', '10:30', 'COMPLETED'), occupied('10:00', '10:30', 'EXPIRED')] })] });
  assert.equal(slot(result, '10:00').available, true);
  const held = run({ staff: [staff({ bookings: [occupied('10:00', '10:30', 'HELD', new Date(now.getTime() + 1))] })] });
  assert.equal(slot(held, '10:00').locked, true); assert.deepEqual(slot(held, '10:00').reasons, ['CAPACITY_FULL', 'TEMPORARY_HOLD']);
  const room = run({ staff: [staff({ parallelCapacity: 2, bookings: [occupied('10:00', '10:30', 'HELD', new Date(now.getTime() + 1))] })] });
  assert.equal(slot(room, '10:00').available, true); assert.equal(slot(room, '10:00').locked, false);
});
test('manual blocks close all resource capacity, including buffer-only overlaps and cross-day blocks', () => {
  const result = run({ policy: { ...policy, bufferAfterMinutes: 15 }, staff: [staff({ parallelCapacity: 3, blocks: [{ startsAt: at('10:40'), endsAt: at('11:00') }, { startsAt: new Date('2026-02-01T23:00:00Z'), endsAt: at('09:15') }] })] });
  assert.equal(slot(result, '10:00').available, false); assert.ok(slot(result, '10:00').reasons.includes('MANUAL_BLOCK'));
  assert.equal(slot(result, '11:00').available, true); assert.equal(slot(result, '09:00').available, false);
});
test('minimum notice is inclusive and the horizon uses the business local date rather than UTC days', () => {
  const result = run({ now: at('09:00'), policy: { ...policy, minimumNoticeMinutes: 60 } });
  assert.equal(slot(result, '09:45').available, false); assert.equal(slot(result, '10:00').available, true);
  const edge = { timezone: 'Pacific/Kiritimati', now: new Date('2026-02-01T11:00:00Z'), policy: { ...policy, maximumAdvanceDays: 1 } };
  assert.ok(run({ ...edge, date: '2026-02-03' }).slots.length); assert.equal(run({ ...edge, date: '2026-02-04' }).slots.length, 0);
  assert.equal(run({ date: '2026-01-31' }).slots.length, 0);
});
test('spring gaps in New York and Jerusalem never produce nonexistent starts and durations are elapsed minutes', () => {
  for (const [timezone, spring, gap] of [['America/New_York', '2026-03-08', '02:'], ['Asia/Jerusalem', '2026-03-27', '02:']] as const) {
    const result = run({ date: spring, timezone, now: new Date('2026-03-01T00:00:00Z'), businessWindows: hours('00:00', '05:00'), staff: [staff({ windows: hours('00:00', '05:00') })] });
    assert.equal(result.slots.some(item => item.localTime.startsWith(gap)), false);
    assert.equal(result.slots.find(item => item.localTime === '01:45')!.available, true);
    assert.ok(result.slots.every(item => new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime() === 1800000));
    const adjacent = run({ date: spring, timezone, now: new Date('2026-03-01T00:00:00Z'), businessWindows: [...hours('00:00', '02:30'), ...hours('02:30', '05:00')], staff: [staff({ windows: hours('00:00', '05:00') })] });
    assert.equal(adjacent.warnings.length, 0); assert.equal(slot(adjacent, '01:45').available, true);
    const badBoundary = run({ date: spring, timezone, now: new Date('2026-03-01T00:00:00Z'), businessWindows: hours('02:30', '05:00') });
    assert.equal(badBoundary.slots.length, 0); assert.ok(badBoundary.warnings.some(item => item.code === 'NONEXISTENT_SCHEDULE_BOUNDARY'));
  }
});
test('fall folds expose distinct absolute starts/offsets and permit long elapsed services within actual hours', () => {
  for (const [timezone, fall] of [['America/New_York', '2026-11-01'], ['Asia/Jerusalem', '2026-10-25']] as const) {
    const input = { date: fall, timezone, now: new Date('2026-10-01T00:00:00Z'), businessWindows: hours('00:00', '04:00'), staff: [staff({ windows: hours('00:00', '04:00') })] };
    const result = run(input), repeated = result.slots.filter(item => item.localTime === '01:30');
    assert.equal(repeated.length, 2); assert.notEqual(repeated[0]!.startsAt, repeated[1]!.startsAt); assert.notEqual(repeated[0]!.utcOffset, repeated[1]!.utcOffset);
    assert.equal(new Set(result.slots.map(item => item.startsAt)).size, result.slots.length);
    const long = run({ ...input, durationMinutes: 180, businessWindows: hours('00:00', '03:00'), staff: [staff({ windows: hours('00:00', '03:00') })] });
    assert.equal(slot(long, '00:30').available, true);
    const bad = run({ ...input, businessWindows: hours('01:30', '04:00') });
    assert.equal(bad.slots.length, 0); assert.ok(bad.warnings.some(item => item.code === 'AMBIGUOUS_SCHEDULE_BOUNDARY'));
  }
});
test('conflict reasons contain no customer or booking identifiers and default results contain only available slots', () => {
  const result = run({ includeUnavailable: false, staff: [staff({ bookings: [occupied('10:00', '10:30')] })] });
  assert.ok(result.slots.every(item => item.available)); assert.equal(slot(result, '10:00'), undefined);
  assert.throws(() => occupiedInterval(new Date(NaN), 30), RangeError);
  const resource = staff({ parallelCapacity: 0 });
  assert.throws(() => evaluateCandidate({ startsAt: at('10:00'), durationMinutes: 30, timezone: 'UTC', now, policy, staff: resource, windows: workingWindows(date, 'UTC', hours(), hours()).intervals }), RangeError);
});

test('availability repository and legacy/compatibility routes share scoped schedule, capacity and override behavior', async t => {
  const runId = randomUUID(), token = randomUUID();
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'VALIDATION_ERROR' } }));
  await registerBookingRoutes(app); await registerScreenFlows(app);
  const businesses = await Promise.all(['a', 'b', 'hidden'].map(name => prisma.business.create({ data: { publishedAt: new Date(), location: 'Synthetic fixture', name, slug: `availability-${name}-${runId}`, timezone: 'UTC', approvalStatus: name === 'hidden' ? 'PENDING' : 'APPROVED' } })));
  const a = businesses[0]!, b = businesses[1]!, hidden = businesses[2]!;
  const services = await Promise.all(businesses.map(business => prisma.service.create({ data: { businessId: business.id, name: 'Consultation', durationMinutes: 30 } })));
  const service = services[0]!;
  const resources = await Promise.all([a, a, a, b].map((business, index) => prisma.staff.create({ data: { businessId: business.id, displayName: `Expert ${index}`, parallelCapacity: index === 1 ? 2 : 1 } })));
  const expert = resources[0]!, parallel = resources[1]!, unassigned = resources[2]!, foreign = resources[3]!;
  const owner = await prisma.identity.create({ data: { email: `availability-${runId}@example.test` } });
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const from = (time: string) => new Date(`${day}T${time}:00Z`);
  const url = (businessId = a.id, serviceId = service.id) => `/v1/businesses/${businessId}/availability?serviceId=${serviceId}&date=${day}&includeUnavailable=true`;
  const book = (staffId: string, time: string, status: 'CONFIRMED' | 'HELD' | 'EXPIRED' | 'CANCELLED' = 'CONFIRMED', expiry: Date | null = null) => prisma.booking.create({ data: { businessId: a.id, customerId: owner.id, serviceId: service.id, staffId, startsAt: from(time), endsAt: new Date(from(time).getTime() + 1800000), occupiedFrom: from(time), occupiedUntil: new Date(from(time).getTime() + 1800000), status, holdExpiresAt: expiry, idempotencyKey: randomUUID() } });
  try {
    for (const business of businesses) {
      await prisma.bookingPolicy.create({ data: { businessId: business.id, ...policy, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
      await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
    }
    await prisma.staffService.createMany({ data: [{ businessId: a.id, staffId: expert.id, serviceId: service.id }, { businessId: a.id, staffId: parallel.id, serviceId: service.id }, { businessId: b.id, staffId: foreign.id, serviceId: services[1]!.id }] });
    await prisma.session.create({ data: { identityId: owner.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
    await t.test('foreign/hidden/archived services and unassigned resources are not exposed', async () => {
      assert.equal((await app.inject({ url: url(a.id, services[1]!.id) })).statusCode, 404);
      assert.equal((await app.inject({ url: url(hidden.id, services[2]!.id) })).statusCode, 404);
      const response = await app.inject({ url: url() }); assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().advisory, true); assert.equal(response.json().timezone, 'UTC');
      assert.deepEqual([...new Set(response.json().slots.map((item: { staffId: string }) => item.staffId))].sort(), [expert.id, parallel.id].sort());
      assert.equal(response.body.includes(unassigned.id), false); assert.equal(response.body.includes(foreign.id), false);
      await prisma.service.update({ where: { id: service.id }, data: { active: false } });
      assert.equal((await app.inject({ url: url() })).statusCode, 404);
      await prisma.service.update({ where: { id: service.id }, data: { active: true } });
      const context = await requirePublicBusiness(a.id);
      await assert.rejects(getBusinessAvailability({ ...context }, service.id, day), error => error instanceof AppError && error.statusCode === 403);
    });
    await t.test('compatibility and v1 paths return the same candidate instants, offsets and conflict reasons', async () => {
      const modern = await app.inject({ url: `/api/providers/${a.id}/availability?serviceId=${service.id}&date=${day}` });
      const legacy = await app.inject({ url: url() });
      assert.equal(modern.statusCode, 200); assert.deepEqual(modern.json(), legacy.json());
      assert.ok(legacy.json().slots.every((item: { startsAt: string; endsAt: string; localTime: string; utcOffset: string }) => item.startsAt.endsWith('Z') && item.endsAt.endsWith('Z') && item.utcOffset === '+00:00' && /^\d\d:\d\d$/.test(item.localTime)));
    });
    await t.test('staff recurrence/override precedence intersects business windows and missing staff days close', async () => {
      await prisma.staffWeeklyAvailability.create({ data: { businessId: a.id, staffId: expert.id, weekday: (new Date(`${day}T00:00Z`).getUTCDay() + 1) % 7, startLocal: '10:00', endLocal: '16:00' } });
      let response = (await app.inject({ url: url() })).json(); assert.equal(response.slots.some((item: { staffId: string }) => item.staffId === expert.id), false);
      await prisma.staffScheduleOverride.create({ data: { businessId: a.id, staffId: expert.id, date: new Date(`${day}T00:00Z`), isOpen: true, startLocal: '10:00', endLocal: '12:00' } });
      response = (await app.inject({ url: url() })).json();
      assert.ok(response.slots.some((item: { staffId: string; localTime: string; available: boolean }) => item.staffId === expert.id && item.localTime === '10:00' && item.available));
      assert.equal(response.slots.some((item: { staffId: string; localTime: string }) => item.staffId === expert.id && item.localTime === '13:00'), false);
      await prisma.scheduleOverride.create({ data: { businessId: a.id, date: new Date(`${day}T00:00Z`), isOpen: false } });
      assert.equal((await app.inject({ url: url() })).json().slots.length, 0);
      await prisma.scheduleOverride.deleteMany({ where: { businessId: a.id } });
      await prisma.staffWeeklyAvailability.deleteMany({ where: { businessId: a.id } }); await prisma.staffScheduleOverride.deleteMany({ where: { businessId: a.id } });
    });
    await t.test('buffers must fit working hours in both availability and direct hold/reschedule paths', async () => {
      await prisma.bookingPolicy.update({ where: { businessId: a.id }, data: { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } });
      const response = (await app.inject({ url: url() })).json();
      assert.equal(response.slots.find((item: { staffId: string; localTime: string }) => item.staffId === expert.id && item.localTime === '09:00').available, false);
      const payload = { finalConsent: true, businessId: a.id, serviceId: service.id, staffId: expert.id, startsAt: `${day}T09:00:00Z`, idempotencyKey: randomUUID() };
      assert.equal((await app.inject({ method: 'POST', url: '/v1/bookings', headers, payload })).statusCode, 409);
      const existing = await book(expert.id, '11:00');
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${existing.id}/reschedule`, headers, payload: { staffId: expert.id, startsAt: `${day}T09:00:00Z` } })).statusCode, 409);
      await prisma.booking.delete({ where: { id: existing.id } });
      await prisma.bookingPolicy.update({ where: { businessId: a.id }, data: { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } });
    });
    await t.test('capacity and temporary holds update per resource, and cross-day blocks are loaded', async () => {
      await book(parallel.id, '10:00');
      const held = await book(parallel.id, '10:15', 'HELD', new Date(Date.now() + 60000));
      await book(expert.id, '12:00', 'HELD', new Date(Date.now() - 1000));
      await book(expert.id, '12:00', 'EXPIRED'); await book(expert.id, '12:00', 'CANCELLED');
      await prisma.timeBlock.create({ data: { businessId: a.id, staffId: expert.id, startsAt: new Date(from('09:00').getTime() - 43200000), endsAt: from('09:15') } });
      let response = (await app.inject({ url: url() })).json();
      const find = (time: string, id: string) => response.slots.find((item: { staffId: string; localTime: string }) => item.staffId === id && item.localTime === time);
      assert.equal(find('10:00', parallel.id).locked, true); assert.equal(find('10:00', expert.id).available, true);
      assert.equal(find('12:00', expert.id).available, true); assert.equal(find('09:00', expert.id).available, false); assert.equal(find('09:15', expert.id).available, true);
      await prisma.booking.update({ where: { id: held.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      response = (await app.inject({ url: url() })).json(); assert.equal(find('10:00', parallel.id).available, true); assert.equal(find('10:00', parallel.id).locked, false);
      assert.equal(JSON.stringify(response).includes(owner.id), false); assert.equal(JSON.stringify(response).includes(held.id), false);
    });
    await t.test('a previously available result never grants confirmation after authoritative capacity changes', async () => {
      const before = (await app.inject({ url: url() })).json();
      assert.ok(before.slots.find((item: { staffId: string; localTime: string }) => item.staffId === expert.id && item.localTime === '14:00').available);
      const stale = await book(expert.id, '14:00', 'HELD', new Date(Date.now() - 1000));
      await book(expert.id, '14:00');
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${stale.id}/confirm`, headers, payload: {} })).statusCode, 409);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: stale.id } })).status, 'HELD');
    });
  } finally {
    await prisma.booking.deleteMany({ where: { businessId: { in: businesses.map(business => business.id) } } });
    await prisma.business.deleteMany({ where: { id: { in: businesses.map(business => business.id) } } });
    await prisma.identity.delete({ where: { id: owner.id } }); await app.close(); await prisma.$disconnect(); redis.disconnect();
  }
});

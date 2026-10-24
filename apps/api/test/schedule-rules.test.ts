import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { AppError } from '../src/http/errors.js';
import { DEFAULT_BOOKING_POLICY, effectiveWindows, parseAvailabilityRules, parseBookingPolicy } from '../src/scheduling/rules.js';
import { possibleLocalInstants, localDateTimeToInstant } from '../src/scheduling/local-time.js';
import { saveBusinessAvailability, saveBusinessPolicy, saveStaffAvailability, getBusinessPolicy } from '../src/repositories/provider-settings.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { tokenDigest } from '../src/security/sessions.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';

const rules = (startLocal = '09:00', endLocal = '17:00') => ({ weekly: [{ weekday: 1, intervals: [{ startLocal, endLocal }] }], overrides: [] });
const validation = (error: unknown) => error instanceof AppError && error.statusCode === 400 && Boolean(error.fields && Object.keys(error.fields).length);

test('schedule validation allows split/adjacent hours and rejects overlap, duplicates and invalid overrides', () => {
  const split = { weekly: [{ weekday: 1, intervals: [{ startLocal: '09:00', endLocal: '12:00' }, { startLocal: '13:00', endLocal: '17:00' }] }], overrides: [] };
  assert.deepEqual(parseAvailabilityRules(split, 'UTC'), split);
  assert.doesNotThrow(() => parseAvailabilityRules({ ...split, weekly: [{ weekday: 1, intervals: [{ startLocal: '09:00', endLocal: '12:00' }, { startLocal: '12:00', endLocal: '17:00' }] }] }, 'UTC'));
  for (const input of [
    { ...split, weekly: [{ weekday: 1, intervals: [{ startLocal: '09:00', endLocal: '13:00' }, { startLocal: '12:00', endLocal: '17:00' }] }] },
    { ...split, weekly: [split.weekly[0], split.weekly[0]] },
    rules('17:00', '09:00'), rules('09:60'), rules('24:00'),
    { weekly: [], overrides: [{ date: '2026-02-30', isOpen: false }] },
    { weekly: [], overrides: [{ date: '2026-01-01', isOpen: true }] },
    { weekly: [], overrides: [{ date: '2026-01-01', isOpen: false, startLocal: '09:00' }] },
    { weekly: [], overrides: [{ date: '2026-01-01', isOpen: false }, { date: '2026-01-01', isOpen: false }] },
    { ...split, businessId: 'foreign' },
  ]) assert.throws(() => parseAvailabilityRules(input, 'UTC'), validation);
});

test('explicit overrides replace recurrence and unspecified business days are closed', () => {
  const weekly = rules().weekly[0]!.intervals;
  assert.deepEqual(effectiveWindows(null, []), []);
  assert.deepEqual(effectiveWindows(null, weekly), weekly);
  assert.deepEqual(effectiveWindows({ isOpen: false, startLocal: null, endLocal: null }, weekly), []);
  assert.deepEqual(effectiveWindows({ isOpen: true, startLocal: '11:00', endLocal: '14:00' }, weekly), [{ startLocal: '11:00', endLocal: '14:00' }]);
});

test('policy defaults are a prefill only; explicit bounded values remain required', () => {
  assert.deepEqual(parseBookingPolicy(DEFAULT_BOOKING_POLICY), DEFAULT_BOOKING_POLICY);
  assert.throws(() => parseBookingPolicy({}), validation);
  assert.throws(() => parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, minimumNoticeMinutes: 1441, maximumAdvanceDays: 1 }), validation);
  assert.throws(() => parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, bufferBeforeMinutes: -1 }), validation);
  assert.throws(() => parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, maximumAdvanceDays: 731 }), validation);
  assert.doesNotThrow(() => parseBookingPolicy({ ...DEFAULT_BOOKING_POLICY, minimumNoticeMinutes: 0, bufferAfterMinutes: 1440, maximumAdvanceDays: 1 }));
});

test('New York and Jerusalem clock changes reject invalid overrides and require booking offset choices', () => {
  for (const [timezone, spring, gap, fall, fold] of [
    ['America/New_York', '2026-03-08', '02:30', '2026-11-01', '01:30'],
    ['Asia/Jerusalem', '2026-03-27', '02:30', '2026-10-25', '01:30'],
  ] as const) {
    assert.equal(possibleLocalInstants(spring, gap, timezone).length, 0);
    assert.equal(possibleLocalInstants(fall, fold, timezone).length, 2);
    assert.throws(() => parseAvailabilityRules({ weekly: [], overrides: [{ date: spring, isOpen: true, startLocal: gap, endLocal: '04:00' }] }, timezone), validation);
    assert.throws(() => parseAvailabilityRules({ weekly: [], overrides: [{ date: fall, isOpen: true, startLocal: fold, endLocal: '04:00' }] }, timezone), validation);
    assert.throws(() => localDateTimeToInstant(fall, fold, timezone), /ambiguous/);
    assert.doesNotThrow(() => parseAvailabilityRules({ weekly: [], overrides: [{ date: spring, isOpen: true, startLocal: '03:30', endLocal: '04:00' }] }, timezone));
  }
});

test('schedule repositories validate consistently and changes preserve existing appointments', async t => {
  const suffix = randomUUID();
  const identity = await prisma.identity.create({ data: { email: `schedule-${suffix}@example.test` } });
  const businesses = await Promise.all(['a', 'b'].map(name => prisma.business.create({ data: { name, slug: `schedule-${name}-${suffix}`, timezone: 'UTC', approvalStatus: 'APPROVED' } })));
  for (const business of businesses) await prisma.membership.create({ data: { businessId: business.id, identityId: identity.id, role: 'OWNER', status: 'ACTIVE' } });
  const business = businesses[0]!;
  const context = await requireBusinessMembership(identity.id, business.id);
  const otherContext = await requireBusinessMembership(identity.id, businesses[1]!.id);
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Schedule test' } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Schedule service', durationMinutes: 30 } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const token = randomUUID();
  await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 60000) } });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => { if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, fields: error.fields } }); return reply.code(500).send({ error: 'unexpected' }); });
  await registerProviderRoutes(app); await registerBookingRoutes(app);
  try {
    await t.test('internal and HTTP writes reject invalid intervals without changing stored rules', async () => {
      await saveBusinessAvailability(context, rules());
      await saveBusinessAvailability(otherContext, rules('10:00', '15:00'));
      const invalid = { weekly: [{ weekday: 1, intervals: [{ startLocal: '09:00', endLocal: '15:00' }, { startLocal: '10:00', endLocal: '11:00' }] }], overrides: [] };
      await assert.rejects(saveBusinessAvailability(context, invalid), validation);
      await assert.rejects(saveStaffAvailability(context, staff.id, invalid), validation);
      const response = await app.inject({ method: 'PUT', url: `/v1/provider/businesses/${business.id}/availability-rules`, headers: { authorization: `Bearer ${token}` }, payload: invalid });
      assert.equal(response.statusCode, 400); assert.ok(response.json().error.fields['weekly.0.intervals.1.startLocal']);
      assert.equal(await prisma.businessWeeklyAvailability.count({ where: { businessId: business.id } }), 1);
      assert.equal((await prisma.businessWeeklyAvailability.findFirstOrThrow({ where: { businessId: businesses[1]!.id } })).startLocal, '10:00');
      assert.equal((await getBusinessPolicy(context)).policy, null);
      await assert.rejects(saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, bufferBeforeMinutes: -1 }), validation);
    });
    await t.test('concurrent full replacements never merge two sets of hours or duplicate overrides', async () => {
      await Promise.all([saveBusinessAvailability(context, rules()), saveBusinessAvailability(context, rules('11:00', '16:00'))]);
      assert.equal(await prisma.businessWeeklyAvailability.count({ where: { businessId: business.id } }), 1);
      await Promise.all([saveStaffAvailability(context, staff.id, rules()), saveStaffAvailability(context, staff.id, rules('11:00', '16:00'))]);
      assert.equal(await prisma.staffWeeklyAvailability.count({ where: { businessId: business.id, staffId: staff.id } }), 1);
    });
    await t.test('closing a day removes availability but preserves confirmed and held booking snapshots', async () => {
      await saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, minimumNoticeMinutes: 0 });
      await saveBusinessAvailability(context, { weekly: [], overrides: [{ date, isOpen: true, startLocal: '09:00', endLocal: '17:00' }] });
      await saveStaffAvailability(context, staff.id, { weekly: [], overrides: [] });
      const before = await app.inject({ method: 'GET', url: `/v1/businesses/${business.id}/availability?serviceId=${service.id}&date=${date}` });
      assert.equal(before.statusCode, 200); assert.ok(before.json().slots.length > 0);
      const create = (hour: string, status: 'CONFIRMED' | 'HELD') => prisma.booking.create({ data: { businessId: business.id, customerId: identity.id, staffId: staff.id, serviceId: service.id, idempotencyKey: randomUUID(), startsAt: new Date(`${date}T${hour}:00:00Z`), endsAt: new Date(`${date}T${hour}:30:00Z`), occupiedFrom: new Date(`${date}T${hour}:00:00Z`), occupiedUntil: new Date(`${date}T${hour}:30:00Z`), status, ...(status === 'HELD' ? { holdExpiresAt: new Date(Date.now() + 60000) } : {}) } });
      const records = await Promise.all([create('09', 'CONFIRMED'), create('10', 'HELD')]);
      await saveBusinessAvailability(context, { weekly: rules().weekly, overrides: [{ date, isOpen: false }] });
      const after = await app.inject({ method: 'GET', url: `/v1/businesses/${business.id}/availability?serviceId=${service.id}&date=${date}` });
      assert.deepEqual(after.json().slots, []);
      for (const record of records) assert.deepEqual(await prisma.booking.findUniqueOrThrow({ where: { id: record.id } }), record);
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: { in: businesses.map(b => b.id) } } });
    await prisma.business.deleteMany({ where: { id: { in: businesses.map(b => b.id) } } });
    await prisma.identity.delete({ where: { id: identity.id } });
    await prisma.$disconnect();
  }
});

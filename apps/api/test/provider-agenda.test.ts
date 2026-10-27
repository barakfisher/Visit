import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { tokenDigest } from '../src/security/sessions.js';
import { readProviderAgenda } from '../src/repositories/ProviderAgenda.service.js';
import { previewSchedule } from '../src/repositories/ScheduleImpact.service.js';
import { saveBusinessAvailability, saveStaffAvailability } from '../src/repositories/provider-settings.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { isTransactionConflict } from '../src/scheduling/booking-transaction.js';
import { releaseHold } from '../src/scheduling/reservations.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';

const hours = (startLocal = '08:00', endLocal = '18:00') => ({ weekly: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ startLocal, endLocal }] })), overrides: [] });
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
after(async () => { redis.disconnect(); await prisma.$disconnect(); });

test('provider agenda and schedule edits preserve private bookings and occupied intervals', async t => {
  const key = randomUUID(), token = randomUUID();
  const owner = await prisma.identity.create({ data: { email: `agenda-${key}@example.test` } });
  const business = await prisma.business.create({ data: { slug: `agenda-${key}`, name: 'Agenda', approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'America/New_York' } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Agenda staff', parallelCapacity: 20 } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Snapshot service', durationMinutes: 30 } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  const membership = await prisma.membership.create({ data: { businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
  const session = await prisma.session.create({ data: { identityId: owner.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  const context = await requireBusinessMembership(owner.id, business.id);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INVALID' } }));
  await registerProviderRoutes(app); await registerScreenFlows(app); await registerBookingRoutes(app);
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
  const create = async (suffix: string, starts: string, ends: string, held = false) => {
    const startsAt = new Date(starts), endsAt = new Date(ends);
    const booking = await prisma.booking.create({ data: { id: `${key}-${suffix}`, businessId: business.id, staffId: staff.id, serviceId: service.id, customerId: owner.id, customerName: 'Customer', status: held ? 'HELD' : 'CONFIRMED', holdExpiresAt: held ? new Date(Date.now() + 300000) : null, startsAt, endsAt, occupiedFrom: new Date(+startsAt - 600000), occupiedUntil: new Date(+endsAt + 600000), idempotencyKey: randomUUID(), serviceName: 'Snapshot service', serviceDurationMinutes: 30 } });
    return booking;
  };
  try {
    await saveBusinessAvailability(context, hours());
    await t.test('DST day uses local midnight boundaries and overlap, with deterministic order', async () => {
      await create('prior', '2027-03-14T04:40:00Z', '2027-03-14T05:10:00Z');
      await create('z', '2027-03-15T03:10:00Z', '2027-03-15T03:40:00Z');
      await create('a', '2027-03-15T03:10:00Z', '2027-03-15T03:40:00Z');
      await create('outside', '2027-03-15T04:10:00Z', '2027-03-15T04:40:00Z');
      const day = await readProviderAgenda(context, '2027-03-14', 1);
      assert.deepEqual(day.bookings.map(row => row.id), [`${key}-prior`, `${key}-a`, `${key}-z`]);
      assert.equal(day.business.timezone, 'America/New_York');
      assert.equal(day.fromDate, '2027-03-14'); assert.equal(day.toDate, '2027-03-14');
      assert.deepEqual(Object.keys(day.bookings[0]!).sort(), ['id', 'revision', 'status', 'startsAt', 'endsAt', 'customer', 'service', 'staff'].sort());
      const week = await readProviderAgenda(context, '2027-03-17', 7);
      assert.equal(week.fromDate, '2027-03-14'); assert.equal(week.toDate, '2027-03-20'); assert.equal(week.bookings.length, 4);
      await prisma.booking.deleteMany({ where: { businessId: business.id } });
    });
    const booked = await create('buffer', '2027-03-15T13:00:00Z', '2027-03-15T13:30:00Z');
    const held = await create('held', '2027-03-15T16:00:00Z', '2027-03-15T16:30:00Z', true);
    await t.test('preview is read only and includes buffers and valid holds', async () => {
      const before = await prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } });
      const impact = await previewSchedule(context, hours('09:00', '12:00'));
      assert.equal(impact.canSave, false); assert.deepEqual(impact.affected.map(row => row.id), [booked.id, held.id]);
      assert.deepEqual(await prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }), before);
      assert.equal((await previewSchedule(context, hours('09:00', '18:00'))).affected.some(row => row.id === booked.id), true);
      await assert.rejects(saveBusinessAvailability(context, hours('09:00', '18:00')), code('SCHEDULE_CONFLICT'));
      await assert.rejects(saveStaffAvailability(context, staff.id, hours('09:00', '18:00')), code('SCHEDULE_CONFLICT'));
    });
    await t.test('v1 and compatibility saves cannot silently invalidate appointments', async () => {
      for (const url of [`/v1/provider/businesses/${business.id}/availability-rules`, `/api/provider/working-hours?businessId=${business.id}`, `/v1/provider/businesses/${business.id}/staff/${staff.id}/availability-rules`]) {
        const response = await app.inject({ method: 'PUT', url, headers, payload: hours('09:00', '18:00') });
        assert.equal(response.statusCode, 409, response.body);
      }
    });
    await t.test('breaks reject occupied buffers, active holds, ambiguous time and foreign resources', async () => {
      const url = '/api/provider/block-time';
      const base = { businessId: business.id, staffId: staff.id, date: '2027-03-15', startLocal: '08:50', endLocal: '09:00' };
      for (const payload of [base, { ...base, startLocal: '12:00', endLocal: '12:10' }]) {
        const response = await app.inject({ method: 'POST', url, headers, payload });
        assert.equal(response.statusCode, 409, response.body);
      }
      assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...base, date: '2027-11-07', startLocal: '01:10', endLocal: '01:40' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...base, staffId: 'foreign-resource' } })).statusCode, 404);
      const saved = await app.inject({ method: 'POST', url, headers, payload: { ...base, startLocal: '14:00', endLocal: '14:30' } });
      assert.equal(saved.statusCode, 201, saved.body);
      const block = saved.json<{ id: string }>();
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${block.id}?businessId=${business.id}`, headers })).statusCode, 200);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${block.id}?businessId=${business.id}`, headers })).statusCode, 404);
    });
    await t.test('preview token fences booking revision and schedule changes', async () => {
      const preview = await previewSchedule(context, hours());
      await prisma.booking.update({ where: { id: booked.id }, data: { startsAt: new Date('2027-03-15T13:10:00Z'), endsAt: new Date('2027-03-15T13:40:00Z'), occupiedFrom: new Date('2027-03-15T13:00:00Z'), occupiedUntil: new Date('2027-03-15T13:50:00Z') } });
      await assert.rejects(saveBusinessAvailability(context, hours(), preview.token), code('SCHEDULE_CHANGED'));
      const current = await previewSchedule(context, hours());
      await saveBusinessAvailability(context, hours('07:00', '18:00'));
      await assert.rejects(saveBusinessAvailability(context, hours(), current.token), code('SCHEDULE_CHANGED'));
      const legacy = await app.inject({ method: 'PUT', url: `/api/provider/working-hours?businessId=${business.id}`, headers: { ...headers, 'x-visit-schedule-preview': current.token }, payload: hours() });
      assert.equal(legacy.statusCode, 409); assert.equal(legacy.json().error.code, 'SCHEDULE_CHANGED');
    });
    await t.test('concurrent edits sharing a preview permit one commit and reject the stale competitor', async () => {
      const proposal = hours('06:00', '18:00');
      const preview = await previewSchedule(context, proposal);
      const outcomes = await Promise.allSettled([
        saveBusinessAvailability(context, proposal, preview.token),
        saveBusinessAvailability(context, proposal, preview.token),
      ]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      const failure = outcomes.find(result => result.status === 'rejected');
      assert.ok(failure && failure.status === 'rejected');
      assert.ok(code('SCHEDULE_CHANGED')(failure.reason));
      assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 2);
    });
    await t.test('a serializable booking snapshot taken before an edit cannot lock and continue stale', async () => {
      let signalSnapshot: (() => void) | undefined;
      let allowLock: (() => void) | undefined;
      const snapshotReady = new Promise<void>(resolve => { signalSnapshot = resolve; });
      const editCommitted = new Promise<void>(resolve => { allowLock = resolve; });
      const staleReader = prisma.$transaction(async tx => {
        await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { updatedAt: true } });
        signalSnapshot?.();
        await editCommitted;
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${business.id} FOR SHARE`;
      }, { isolationLevel: 'Serializable', timeout: 15000 });
      // Observe the rejection immediately so a serialization error is never unhandled.
      const rejected = assert.rejects(staleReader, isTransactionConflict);
      await snapshotReady;
      try { await saveBusinessAvailability(context, hours('05:00', '18:00')); }
      finally { allowLock?.(); }
      await rejected;
    });
    await t.test('concurrent booking creation and date closure never both commit', async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const date = `2027-03-${23 + attempt}`, startsAt = new Date(`${date}T14:00:00Z`);
        await saveBusinessAvailability(context, hours('06:00', '18:00'));
        const closed = { ...hours('06:00', '18:00'), overrides: [{ date, isOpen: false }] };
        const [reservation, edit] = await Promise.all([
          app.inject({ method: 'POST', url: '/v1/bookings', headers, payload: { finalConsent: true, businessId: business.id, serviceId: service.id, staffId: staff.id, startsAt: startsAt.toISOString(), idempotencyKey: randomUUID() } }),
          saveBusinessAvailability(context, closed).then(() => ({ saved: true as const }), (error: unknown) => ({ saved: false as const, error })),
        ]);
        const created = reservation.statusCode === 201;
        assert.equal(created && edit.saved, false, 'A live reservation and a closure for its date cannot both commit');
        if (created) {
          assert.equal(edit.saved, false);
          if (!edit.saved) assert.ok(code('SCHEDULE_CONFLICT')(edit.error));
        } else {
          assert.equal(reservation.statusCode, 409, reservation.body);
          assert.equal(edit.saved, true);
        }
        const reservations = await prisma.booking.findMany({ where: { businessId: business.id, startsAt }, select: { id: true, customerId: true, status: true } });
        assert.equal(reservations.filter(row => row.status === 'HELD').length, created ? 1 : 0);
        for (const hold of reservations) await releaseHold(hold.id, hold.customerId);
        await prisma.booking.deleteMany({ where: { businessId: business.id, startsAt } });
        await saveBusinessAvailability(context, hours('06:00', '18:00'));
      }
    });
    await t.test('unowned business and missing staff stay inaccessible; held rows do not enter agenda', async () => {
      await assert.rejects(requireBusinessMembership(owner.id, 'foreign-business'), code('FORBIDDEN'));
      await assert.rejects(previewSchedule(context, hours(), 'foreign-staff'), code('NOT_FOUND'));
      const agenda = await readProviderAgenda(context, '2027-03-15', 1);
      assert.deepEqual(agenda.bookings.map(row => row.id), [booked.id]);
      const empty = await readProviderAgenda(context, '2027-03-22', 1);
      assert.deepEqual(empty.bookings, []); assert.deepEqual(empty.blocks, []);
      assert.deepEqual(empty.summary, { appointments: 0, revenue: {} });
      assert.equal((await app.inject({ url: `/api/provider/agenda?businessId=${business.id}&date=2027-03-15` })).statusCode, 401);
      for (const query of ['date=invalid', 'date=2027-03-15&days=2', 'date=2027-03-15&identityId=forged']) {
        assert.equal((await app.inject({ url: `/api/provider/agenda?businessId=${business.id}&${query}`, headers })).statusCode, 400);
      }
    });
    await t.test('revoked session and removed membership reject mutation and reads', async () => {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      assert.equal((await app.inject({ method: 'PUT', url: `/v1/provider/businesses/${business.id}/availability-rules`, headers, payload: hours() })).statusCode, 401);
      await prisma.membership.delete({ where: { id: membership.id } });
      await assert.rejects(readProviderAgenda(context, '2027-03-14', 1), code('FORBIDDEN'));
      await assert.rejects(previewSchedule(context, hours()), code('FORBIDDEN'));
    });
  } finally {
    await app.close(); await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } }); await prisma.identity.delete({ where: { id: owner.id } });
  }
});

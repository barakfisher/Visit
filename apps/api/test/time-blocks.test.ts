import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { authenticate, tokenDigest } from '../src/security/sessions.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { BLOCK_CONFLICT, MAX_BLOCK_DAYS, MAX_REPORTED_CONFLICTS, createTimeBlock } from '../src/repositories/TimeBlocks.service.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

type Block = { id: string; staff: { id: string; displayName: string } | null; allDay: boolean; reason: string | null; startsAt: string; endsAt: string; fromDate: string; toDate: string; startLocal?: string; endLocal?: string };
type Slot = { staffId: string; localTime: string; available: boolean; reasons: string[] };

test('time blocks cover hours, whole days, date ranges and the whole business', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Blocks', slug: `blocks-${run}`, timezone: 'America/New_York', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const people = await Promise.all(['owner', 'manager', 'staff', 'customer'].map(role => prisma.identity.create({ data: { email: `blocks-${role}-${run}@example.test` } })));
  const [owner, manager, staffMember, customer] = people;
  assert.ok(owner && manager && staffMember && customer);
  // The booking trigger snapshots the customer's name from their identity.
  await prisma.identity.update({ where: { id: customer.id }, data: { displayName: 'Dana' } });
  const tokens = new Map<string, string>();
  for (const person of people) {
    const token = randomUUID(); tokens.set(person.id, token);
    await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  }
  await prisma.membership.createMany({ data: [
    { businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    { businessId: business.id, identityId: manager.id, role: 'MANAGER', status: 'ACTIVE' },
    { businessId: business.id, identityId: staffMember.id, role: 'STAFF', status: 'ACTIVE' },
  ] });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Visit', durationMinutes: 30 } });
  const [first, second, inactive] = await Promise.all(['First', 'Second', 'Inactive'].map(displayName => prisma.staff.create({ data: { businessId: business.id, displayName, active: displayName !== 'Inactive' } })));
  assert.ok(first && second && inactive);
  await prisma.staffService.createMany({ data: [first, second].map(staff => ({ businessId: business.id, staffId: staff.id, serviceId: service.id })) });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '08:00', endLocal: '18:00' })) });
  const app = await createApp();
  const headers = (id = owner.id) => ({ authorization: `Bearer ${tokens.get(id)}`, 'x-visit-client': 'native' });
  const block = (payload: Record<string, unknown>, id = owner.id) => app.inject({ method: 'POST', url: '/api/provider/block-time', headers: headers(id), payload: { businessId: business.id, ...payload } });
  const list = (id = owner.id) => app.inject({ url: `/api/provider/block-time?businessId=${business.id}`, headers: headers(id) });
  const slots = async (date: string) => (await app.inject({ url: `/v1/businesses/${business.id}/availability?serviceId=${service.id}&date=${date}&includeUnavailable=true` })).json().slots as Slot[];
  const book = (staffId: string, startsAt: string, status: 'CONFIRMED' | 'HELD' = 'CONFIRMED') => prisma.booking.create({ data: { businessId: business.id, staffId, serviceId: service.id, customerId: customer.id, serviceName: service.name, status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 300000) : null, idempotencyKey: randomUUID(), startsAt: new Date(startsAt), endsAt: new Date(+new Date(startsAt) + 1800000), occupiedFrom: new Date(startsAt), occupiedUntil: new Date(+new Date(startsAt) + 1800000) } });
  try {
    await t.test('a whole-business date range runs from local midnight to the midnight after its last day, across a clock change', async () => {
      const response = await block({ kind: 'days', fromDate: '2027-03-13', toDate: '2027-03-15', reason: 'Spring break' });
      assert.equal(response.statusCode, 201, response.body);
      const created = response.json<Block>();
      assert.deepEqual({ staff: created.staff, allDay: created.allDay, reason: created.reason, fromDate: created.fromDate, toDate: created.toDate, startsAt: created.startsAt, endsAt: created.endsAt },
        { staff: null, allDay: true, reason: 'Spring break', fromDate: '2027-03-13', toDate: '2027-03-15', startsAt: '2027-03-13T05:00:00.000Z', endsAt: '2027-03-16T04:00:00.000Z' });
      assert.equal('startLocal' in created, false);
      const listed = await list();
      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(listed.json().timezone, 'America/New_York');
      assert.deepEqual(listed.json().blocks.map((row: Block) => row.id), [created.id]);
      const agenda = await app.inject({ url: `/api/provider/agenda?businessId=${business.id}&date=2027-03-14`, headers: headers() });
      assert.deepEqual(agenda.json().blocks.map((row: Block) => [row.id, row.staff, row.fromDate, row.toDate]), [[created.id, null, '2027-03-13', '2027-03-15']]);
    });

    await t.test('a whole-business block closes every staff member, including one added after it', async () => {
      const later = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Later' } });
      await prisma.staffService.create({ data: { businessId: business.id, staffId: later.id, serviceId: service.id } });
      const day = await slots('2027-03-14');
      assert.ok(day.some(slot => slot.staffId === later.id));
      assert.ok(day.length > 0 && day.every(slot => !slot.available && slot.reasons.includes('MANUAL_BLOCK')));
      const reservation = await app.inject({ method: 'POST', url: '/v1/bookings', headers: headers(customer.id), payload: { finalConsent: true, businessId: business.id, serviceId: service.id, staffId: later.id, startsAt: '2027-03-14T14:00:00.000Z', idempotencyKey: randomUUID() } });
      assert.equal(reservation.statusCode, 409, reservation.body);
      assert.ok((await slots('2027-03-16')).some(slot => slot.available), 'the day after the range is bookable');
    });

    await t.test('hours on one day keep their local times, and a staff block leaves other staff bookable', async () => {
      const response = await block({ staffId: first.id, date: '2027-03-20', startLocal: '10:00', endLocal: '12:00', reason: 'Dentist' });
      assert.equal(response.statusCode, 201, response.body);
      const created = response.json<Block>();
      assert.deepEqual([created.staff?.id, created.allDay, created.fromDate, created.toDate, created.startLocal, created.endLocal], [first.id, false, '2027-03-20', '2027-03-20', '10:00', '12:00']);
      const day = await slots('2027-03-20');
      assert.equal(day.find(slot => slot.staffId === first.id && slot.localTime === '10:30')?.available, false);
      assert.equal(day.find(slot => slot.staffId === second.id && slot.localTime === '10:30')?.available, true);
      assert.equal(day.find(slot => slot.staffId === first.id && slot.localTime === '12:00')?.available, true);
    });

    await t.test('a block over appointments or reservations is refused with the list; overlapping blocks are allowed', async () => {
      const appointment = await book(first.id, '2027-04-05T19:00:00.000Z');
      await book(second.id, '2027-04-05T20:00:00.000Z', 'HELD');
      const before = await prisma.timeBlock.count({ where: { businessId: business.id } });
      const refused = await block({ kind: 'days', fromDate: '2027-04-05', toDate: '2027-04-05' });
      assert.equal(refused.statusCode, 409, refused.body);
      const error = refused.json().error;
      assert.equal(error.code, BLOCK_CONFLICT);
      assert.equal(error.details.total, 2);
      assert.deepEqual(error.details.conflicts[0], { kind: 'APPOINTMENT', id: appointment.id, startsAt: '2027-04-05T19:00:00.000Z', endsAt: '2027-04-05T19:30:00.000Z', staffName: 'First', customerName: 'Dana', serviceName: 'Visit' });
      assert.deepEqual(error.details.conflicts[1], { kind: 'RESERVATION', startsAt: '2027-04-05T20:00:00.000Z', endsAt: '2027-04-05T20:30:00.000Z', staffName: 'Second' }, 'a reservation carries no customer details');
      assert.equal(await prisma.timeBlock.count({ where: { businessId: business.id } }), before);
      const staffOnly = await block({ staffId: second.id, kind: 'days', fromDate: '2027-04-05', toDate: '2027-04-05' });
      assert.equal(staffOnly.statusCode, 409, 'the held reservation belongs to this staff member');
      assert.equal((await block({ staffId: first.id, date: '2027-04-05', startLocal: '09:00', endLocal: '10:00' })).statusCode, 201);
      assert.equal((await block({ date: '2027-04-05', startLocal: '09:30', endLocal: '10:30' })).statusCode, 201, 'overlapping another block is harmless');
      await prisma.booking.deleteMany({ where: { businessId: business.id } });
    });

    await t.test('the conflict list is bounded while the total stays exact', async () => {
      for (let index = 0; index <= MAX_REPORTED_CONFLICTS; index++) await book(first.id, new Date(Date.UTC(2027, 4, 1 + index, 14)).toISOString());
      const refused = await block({ kind: 'days', fromDate: '2027-05-01', toDate: '2027-05-31' });
      assert.equal(refused.statusCode, 409);
      assert.equal(refused.json().error.details.total, MAX_REPORTED_CONFLICTS + 1);
      assert.equal(refused.json().error.details.conflicts.length, MAX_REPORTED_CONFLICTS);
      await prisma.booking.deleteMany({ where: { businessId: business.id } });
    });

    await t.test('appointments already over do not refuse a block for the rest of today', async () => {
      const session = await authenticate({ headers: { authorization: `Bearer ${tokens.get(owner.id)}` } } as FastifyRequest);
      const context = await requireBusinessMembership(owner.id, business.id);
      const now = new Date('2027-06-10T20:00:00.000Z'); // 16:00 in New York.
      await book(first.id, '2027-06-10T14:00:00.000Z');
      const created = await createTimeBlock(context, { kind: 'days', fromDate: '2027-06-10', toDate: '2027-06-10' }, session, now);
      assert.equal(created.allDay, true);
      await book(first.id, '2027-06-11T21:00:00.000Z');
      await assert.rejects(createTimeBlock(context, { kind: 'days', fromDate: '2027-06-11', toDate: '2027-06-11' }, session, now), (error: unknown) => error instanceof AppError && error.code === BLOCK_CONFLICT);
      await prisma.booking.deleteMany({ where: { businessId: business.id } });
    });

    await t.test('invalid ranges, past time, clock-change gaps and inactive staff are refused', async () => {
      const longest = new Date(Date.UTC(2027, 6, 1 + MAX_BLOCK_DAYS - 1)).toISOString().slice(0, 10), tooLong = new Date(Date.UTC(2027, 6, 1 + MAX_BLOCK_DAYS)).toISOString().slice(0, 10);
      const cases: [Record<string, unknown>, number, string?][] = [
        [{ kind: 'days', fromDate: '2027-07-02', toDate: '2027-07-01' }, 400, 'VALIDATION_ERROR'],
        [{ kind: 'days', fromDate: '2027-07-01', toDate: tooLong }, 400, 'VALIDATION_ERROR'],
        [{ kind: 'days', fromDate: '2027-07-01', toDate: '2027-07-01', startLocal: '09:00' }, 400],
        [{ kind: 'week', fromDate: '2027-07-01', toDate: '2027-07-01' }, 400],
        [{ date: '2027-07-01', startLocal: '12:00', endLocal: '11:00' }, 400, 'VALIDATION_ERROR'],
        [{ date: '2027-07-01', startLocal: '24:00', endLocal: '24:30' }, 400],
        [{ date: '2027-03-14', startLocal: '02:30', endLocal: '04:00' }, 400, 'INVALID_LOCAL_TIME'],
        [{ date: '2027-07-01', startLocal: '09:00', endLocal: '10:00', reason: 'x'.repeat(201) }, 400],
        [{ kind: 'days', fromDate: '2020-01-01', toDate: '2020-01-02' }, 400, 'BLOCK_IN_PAST'],
        [{ staffId: inactive.id, date: '2027-07-01', startLocal: '09:00', endLocal: '10:00' }, 404, 'NOT_FOUND'],
      ];
      const before = await prisma.timeBlock.count({ where: { businessId: business.id } });
      for (const [payload, status, errorCode] of cases) {
        const response = await block(payload);
        assert.equal(response.statusCode, status, `${JSON.stringify(payload)}: ${response.body}`);
        if (errorCode) assert.equal(response.json().error.code, errorCode);
      }
      assert.equal(await prisma.timeBlock.count({ where: { businessId: business.id } }), before);
      const widest = await block({ kind: 'days', fromDate: '2027-07-01', toDate: longest });
      assert.equal(widest.statusCode, 201, widest.body);
    });

    await t.test('only owners and managers list, create and remove blocks', async () => {
      const created = await block({ date: '2027-08-01', startLocal: '09:00', endLocal: '10:00' }, manager.id);
      assert.equal(created.statusCode, 201, created.body);
      assert.equal((await list(manager.id)).statusCode, 200);
      const id = created.json<Block>().id;
      for (const actor of [staffMember.id, customer.id]) {
        assert.equal((await list(actor)).statusCode, 403);
        assert.equal((await block({ date: '2027-08-02', startLocal: '09:00', endLocal: '10:00' }, actor)).statusCode, 403);
        const overAppointments = await block({ kind: 'days', fromDate: '2027-04-05', toDate: '2027-04-05' }, actor);
        assert.equal(overAppointments.statusCode, 403, 'refused before conflicts are looked up');
        assert.equal(overAppointments.json().error.details, undefined, 'no appointment details reach other roles');
        assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${id}?businessId=${business.id}`, headers: headers(actor) })).statusCode, 403);
      }
      assert.equal((await app.inject({ url: `/api/provider/block-time?businessId=${business.id}` })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: '/api/provider/block-time', payload: { businessId: business.id, date: '2027-08-02', startLocal: '09:00', endLocal: '10:00' } })).statusCode, 401);
      assert.equal((await app.inject({ url: `/api/provider/block-time?businessId=${business.id}&staffId=${first.id}`, headers: headers() })).statusCode, 400, 'unknown query fields are refused');
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${id}?businessId=${business.id}`, headers: headers(manager.id) })).statusCode, 200);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${id}?businessId=${business.id}`, headers: headers(manager.id) })).statusCode, 404);
    });

    await t.test('the list holds only blocks that have not ended, in start order', async () => {
      await prisma.timeBlock.create({ data: { businessId: business.id, startsAt: new Date('2020-01-01T00:00:00Z'), endsAt: new Date('2020-01-02T00:00:00Z'), allDay: true } });
      const rows = (await list()).json().blocks as Block[];
      assert.ok(rows.every(row => new Date(row.endsAt) > new Date()));
      assert.deepEqual(rows.map(row => row.startsAt), [...rows.map(row => row.startsAt)].sort());
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.deleteMany({ where: { id: { in: people.map(person => person.id) } } });
  }
});

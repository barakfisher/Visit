import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { tokenDigest } from '../src/security/sessions.js';
import { calendarMembershipWhere, requireCalendarScope, validateCalendarScope } from '../src/security/calendar-scope.js';
import { CUSTOMER_CARD_EXISTS } from '../src/repositories/CustomerCards.service.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

type Agenda = { calendar: { id: string; displayName: string; active: boolean } | null; staff: { id: string }[]; bookings: { id: string; staff: { displayName: string } }[]; blocks: { id: string; staff: { id: string } | null }[]; day: { free: { staffId: string }[] } | null };

// Slice 3 (worker-access.md): a worker linked to one staff row sees and changes that row only; another row reads as not found.
test('a linked worker works their own calendar only', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'My day', slug: `my-day-${run}`, timezone: 'UTC', approvalStatus: 'APPROVED', publishedAt: new Date(), location: 'Synthetic' } });
  const names = ['owner', 'worker', 'colleague', 'customer'] as const;
  const people = Object.fromEntries(await Promise.all(names.map(async name => [name, await prisma.identity.create({ data: { email: `my-day-${name}-${run}@example.test`, emailVerifiedAt: new Date() } })] as const))) as Record<typeof names[number], { id: string }>;
  const tokens = new Map<string, string>();
  for (const person of Object.values(people)) {
    const token = randomUUID(); tokens.set(person.id, token);
    await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  }
  const [cut, color] = await Promise.all([
    prisma.service.create({ data: { businessId: business.id, name: 'Cut', durationMinutes: 30, priceMinor: 8000, currency: 'ILS' } }),
    prisma.service.create({ data: { businessId: business.id, name: 'Color', durationMinutes: 60, priceMinor: 20000, currency: 'ILS' } }),
  ]);
  await prisma.service.create({ data: { businessId: business.id, name: 'Retired', durationMinutes: 30, active: false } });
  const [own, other] = await Promise.all([prisma.staff.create({ data: { businessId: business.id, displayName: 'Noa' } }), prisma.staff.create({ data: { businessId: business.id, displayName: 'Dana' } })]);
  await prisma.staffService.createMany({ data: [{ businessId: business.id, staffId: own.id, serviceId: cut.id }, { businessId: business.id, staffId: other.id, serviceId: cut.id }, { businessId: business.id, staffId: other.id, serviceId: color.id }] });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  await prisma.membership.createMany({ data: [
    { businessId: business.id, identityId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    { businessId: business.id, identityId: people.worker.id, role: 'STAFF', status: 'ACTIVE', staffId: own.id },
    { businessId: business.id, identityId: people.colleague.id, role: 'STAFF', status: 'ACTIVE', staffId: other.id },
  ] });
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), empty = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const appointment = (staffId: string, hour: number, day = date) => prisma.booking.create({ data: { businessId: business.id, customerId: people.customer.id, serviceId: cut.id, staffId, idempotencyKey: randomUUID(), startsAt: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`), endsAt: new Date(`${day}T${String(hour).padStart(2, '0')}:30:00Z`), occupiedFrom: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`), occupiedUntil: new Date(`${day}T${String(hour).padStart(2, '0')}:30:00Z`), status: 'CONFIRMED', serviceName: 'Cut', serviceDurationMinutes: 30, servicePriceMinor: 8000, serviceCurrency: 'ILS' } });
  const mine = await appointment(own.id, 9), theirs = await appointment(other.id, 10);
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const [minePast, theirsPast] = [await appointment(own.id, 9, past), await appointment(other.id, 10, past)];
  const [ownBlock, otherBlock, wideBlock] = await Promise.all([
    prisma.timeBlock.create({ data: { businessId: business.id, staffId: own.id, startsAt: new Date(`${date}T13:00:00Z`), endsAt: new Date(`${date}T13:30:00Z`) } }),
    prisma.timeBlock.create({ data: { businessId: business.id, staffId: other.id, startsAt: new Date(`${date}T14:00:00Z`), endsAt: new Date(`${date}T14:30:00Z`) } }),
    prisma.timeBlock.create({ data: { businessId: business.id, staffId: null, startsAt: new Date(`${date}T20:00:00Z`), endsAt: new Date(`${date}T21:00:00Z`) } }),
  ]);
  const card = await prisma.customerCard.create({ data: { businessId: business.id, name: 'Shira Levi', phone: '+972501234567' } });
  const app = await createApp();
  const headers = (id: string) => ({ authorization: `Bearer ${tokens.get(id)}`, 'x-visit-client': 'native' });
  const worker = headers(people.worker.id), base = `/v1/provider/businesses/${business.id}`;
  const agenda = async (who = worker, day = date, days = 1) => app.inject({ url: `/api/provider/agenda?businessId=${business.id}&date=${day}&days=${days}`, headers: who });
  const move = (bookingId: string, staffId: string, expectedRevision: number, localTime = '11:00') => app.inject({ method: 'POST', url: `${base}/bookings/${bookingId}/reschedule`, headers: worker, payload: { finalConsent: true, idempotencyKey: randomUUID(), expectedRevision, staffId, localDate: date, localTime } });
  const book = (staffId: string, localTime: string, extra: object = {}) => app.inject({ method: 'POST', url: `${base}/manual-bookings`, headers: worker, payload: { finalConsent: true, idempotencyKey: randomUUID(), serviceId: cut.id, staffId, localDate: date, localTime, customerName: 'Walk in', customerPhone: '+972509999999', reviewedService: { name: 'Cut', durationMinutes: 30, priceMinor: 8000, currency: 'ILS' }, ...extra } });
  try {
    await t.test('the profile opens provider mode on their own calendar', async () => {
      const profile = (await app.inject({ url: '/api/auth/me', headers: worker })).json<{ profile: { businesses: { id: string; role: string; calendar?: { id: string; displayName: string; active: boolean } }[] } }>().profile;
      assert.deepEqual(profile.businesses, [{ id: business.id, name: business.name, timezone: business.timezone, role: 'STAFF', calendar: { id: own.id, displayName: 'Noa', active: true } }]);
      const me = (await app.inject({ url: '/v1/me', headers: worker })).json<{ memberships: { calendar: { id: string } | null }[] }>();
      assert.deepEqual(me.memberships.map(m => m.calendar?.id), [own.id]);
    });

    await t.test('My day and the week hold their own row only, with business-wide blocks', async () => {
      for (const days of [1, 7]) {
        const response = await agenda(worker, date, days);
        assert.equal(response.statusCode, 200, response.body);
        const body = response.json<Agenda>();
        assert.deepEqual(body.bookings.map(b => b.id), [mine.id]);
        assert.deepEqual(body.staff.map(s => s.id), [own.id]);
        assert.deepEqual(body.blocks.map(b => b.id).sort(), [ownBlock.id, wideBlock.id].sort());
        assert.deepEqual(body.calendar, { id: own.id, displayName: 'Noa', active: true });
        if (days === 1) assert.ok(body.day!.free.every(gap => gap.staffId === own.id));
        assert.ok(!response.body.includes(theirs.id) && !response.body.includes('Dana') && !response.body.includes(otherBlock.id));
      }
      const owner = (await agenda(headers(people.owner.id))).json<Agenda>();
      assert.equal(owner.calendar, null);
      assert.deepEqual(owner.bookings.map(b => b.id).sort(), [mine.id, theirs.id].sort());
      const list = (await app.inject({ url: `/api/provider/block-time?businessId=${business.id}`, headers: worker })).json<{ blocks: { id: string }[] }>();
      assert.deepEqual(list.blocks.map(b => b.id).sort(), [ownBlock.id, wideBlock.id].sort());
    });

    await t.test('an empty day answers with no appointments', async () => {
      const body = (await agenda(worker, empty)).json<Agenda>();
      assert.deepEqual(body.bookings, []);
      assert.equal(body.calendar?.id, own.id);
    });

    await t.test("history: their own appointment's, never another row's", async () => {
      assert.equal((await app.inject({ url: `${base}/bookings/${mine.id}/history`, headers: worker })).statusCode, 200);
      const refused = await app.inject({ url: `${base}/bookings/${theirs.id}/history`, headers: worker });
      assert.equal(refused.statusCode, 404); assert.ok(!refused.body.includes(other.id));
      assert.equal((await app.inject({ url: `${base}/bookings`, headers: worker })).statusCode, 403);
    });

    await t.test('the add sheet offers their own row and its active services only', async () => {
      const options = (await app.inject({ url: `${base}/manual-booking-options`, headers: worker })).json<{ services: { id: string; staff: { id: string }[] }[] }>();
      assert.deepEqual(options.services.map(s => [s.id, s.staff.map(row => row.id)]), [[cut.id, [own.id]]]);
    });

    await t.test('add: on their own row, never on another', async () => {
      const created = await book(own.id, '15:00');
      assert.equal(created.statusCode, 200, created.body);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: created.json<{ id: string }>().id } })).staffId, own.id);
      const refused = await book(other.id, '15:00');
      assert.equal(refused.statusCode, 404);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, staffId: other.id, source: 'MANUAL' } }), 0);
    });

    await t.test('the database itself refuses a worker manual booking on another row', async () => {
      const session = await prisma.session.findFirstOrThrow({ where: { identityId: people.worker.id } });
      const insert = (staffId: string) => prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('visit.booking_actor', ${people.worker.id}, true), set_config('visit.booking_source', 'MANUAL', true), set_config('visit.booking_reason', 'MANUAL_ENTRY', true), set_config('visit.booking_session', ${session.id}, true)`;
        return tx.booking.create({ data: { businessId: business.id, serviceId: cut.id, staffId, source: 'MANUAL', enteredByIdentityId: people.worker.id, customerName: 'Direct', customerPhone: '+972500000002', idempotencyKey: randomUUID(), startsAt: new Date(`${empty}T08:00:00Z`), endsAt: new Date(`${empty}T08:30:00Z`), occupiedFrom: new Date(`${empty}T08:00:00Z`), occupiedUntil: new Date(`${empty}T08:30:00Z`), status: 'CONFIRMED', serviceName: 'Cut', serviceDurationMinutes: 30 } });
      });
      // Every earlier condition of the guard holds, so this is its membership check; the own-row path is the API test above.
      await assert.rejects(insert(other.id), /VISIT_MANUAL_BOOKING_AUTHORIZATION/);
    });

    await t.test('customer search covers every card of the business, and the existing card is offered', async () => {
      const found = (await app.inject({ url: `${base}/customer-cards?q=Shira`, headers: worker })).json<{ cards: { id: string }[] }>();
      assert.deepEqual(found.cards.map(c => c.id), [card.id]);
      const existing = await book(own.id, '16:00', { customerPhone: card.phone, saveCustomer: true });
      assert.equal(existing.statusCode, 409); assert.equal(existing.json<{ error: { code: string } }>().error.code, CUSTOMER_CARD_EXISTS);
      assert.equal((await book(own.id, '16:00', { customerCardId: card.id })).statusCode, 200);
    });

    await t.test('move: their own appointment within their row; another row in either direction is not found', async () => {
      assert.equal((await move(theirs.id, own.id, 0)).statusCode, 404);
      assert.equal((await move(mine.id, other.id, 0)).statusCode, 404);
      const moved = await move(mine.id, own.id, 0);
      assert.equal(moved.statusCode, 200, moved.body);
      const [after, untouched] = await Promise.all([prisma.booking.findUniqueOrThrow({ where: { id: mine.id } }), prisma.booking.findUniqueOrThrow({ where: { id: theirs.id } })]);
      assert.equal(after.startsAt.toISOString(), `${date}T11:00:00.000Z`); assert.equal(after.staffId, own.id);
      assert.equal(untouched.revision, theirs.revision); assert.equal(untouched.staffId, other.id);
    });

    await t.test('outcomes: their own ended appointment, never another row', async () => {
      const outcome = (id: string) => app.inject({ method: 'POST', url: `${base}/bookings/${id}/outcome`, headers: worker, payload: { status: 'NO_SHOW', expectedRevision: 0 } });
      assert.equal((await outcome(theirsPast.id)).statusCode, 404);
      assert.equal((await outcome(minePast.id)).statusCode, 200);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: theirsPast.id } })).status, 'CONFIRMED');
    });

    await t.test('cancel: their own, never another row', async () => {
      const cancel = (id: string) => app.inject({ method: 'POST', url: `${base}/bookings/${id}/cancel`, headers: worker, payload: {} });
      assert.equal((await cancel(theirs.id)).statusCode, 404);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: theirs.id } })).status, 'CONFIRMED');
      assert.equal((await cancel(mine.id)).statusCode, 200);
    });

    await t.test('blocks: add and release on their own row; another row is not found; a whole-business block needs setup', async () => {
      const block = (payload: object) => app.inject({ method: 'POST', url: '/api/provider/block-time', headers: worker, payload: { businessId: business.id, kind: 'days', fromDate: empty, toDate: empty, ...payload } });
      const created = await block({ staffId: own.id });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal((await block({ staffId: other.id })).statusCode, 404);
      assert.equal((await block({})).statusCode, 403);
      const release = (id: string) => app.inject({ method: 'DELETE', url: `/api/provider/block-time/${id}?businessId=${business.id}`, headers: worker });
      assert.equal((await release(otherBlock.id)).statusCode, 404);
      assert.equal((await release(wideBlock.id)).statusCode, 404);
      assert.equal((await release(created.json<{ id: string }>().id)).statusCode, 200);
      assert.equal(await prisma.timeBlock.count({ where: { id: { in: [otherBlock.id, wideBlock.id] } } }), 2);
      // The owner still blocks the whole business, which is setup.
      assert.equal((await app.inject({ method: 'POST', url: '/api/provider/block-time', headers: headers(people.owner.id), payload: { businessId: business.id, kind: 'days', fromDate: empty, toDate: empty } })).statusCode, 201);
    });

    await t.test('settings, the catalogue and the team stay closed', async () => {
      for (const url of [base, `${base}/services`, `${base}/services/${cut.id}`, `${base}/booking-policy`, `${base}/staff`, `${base}/publication`, `${base}/team`, `/api/provider/services?businessId=${business.id}`]) {
        assert.equal((await app.inject({ url, headers: worker })).statusCode, 403, url);
      }
    });

    await t.test('a row marked unavailable keeps its appointments and offers no new booking', async () => {
      await prisma.staff.update({ where: { id: own.id }, data: { active: false } });
      const body = (await agenda()).json<Agenda>();
      assert.deepEqual(body.calendar, { id: own.id, displayName: 'Noa', active: false });
      assert.ok(body.bookings.length > 0);
      assert.deepEqual(body.staff, []);
      assert.deepEqual((await app.inject({ url: `${base}/manual-booking-options`, headers: worker })).json<{ services: unknown[] }>().services, []);
      assert.equal((await book(own.id, '17:00')).statusCode, 404);
      const profile = (await app.inject({ url: '/api/auth/me', headers: worker })).json<{ profile: { businesses: { calendar?: { active: boolean } }[] } }>().profile;
      assert.equal(profile.businesses[0]?.calendar?.active, false);
      await prisma.staff.update({ where: { id: own.id }, data: { active: true } });
    });

    await t.test('a scope issued before a relink is refused', async () => {
      const scope = await requireCalendarScope(people.colleague.id, business.id, 'act');
      assert.equal(scope.staffId, other.id);
      const moved = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Moved' } });
      await prisma.membership.updateMany({ where: { businessId: business.id, identityId: people.colleague.id }, data: { staffId: moved.id } });
      await assert.rejects(validateCalendarScope(scope, 'act'), { statusCode: 403 });
      assert.equal(await prisma.membership.count({ where: calendarMembershipWhere(scope, 'act') }), 0);
      assert.equal((await requireCalendarScope(people.colleague.id, business.id, 'act')).staffId, moved.id);
      await prisma.membership.updateMany({ where: { businessId: business.id, identityId: people.colleague.id }, data: { status: 'REVOKED' } });
      await assert.rejects(requireCalendarScope(people.colleague.id, business.id, 'see'), { statusCode: 403 });
    });

    await t.test('a removed worker is back in customer mode on the next read', async () => {
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.worker.id } });
      const removed = await app.inject({ method: 'DELETE', url: `${base}/members/${membership.id}`, headers: headers(people.owner.id) });
      assert.ok(removed.statusCode < 400, removed.body);
      assert.deepEqual((await app.inject({ url: '/api/auth/me', headers: worker })).json<{ profile: { businesses: unknown[] } }>().profile.businesses, []);
      assert.equal((await agenda()).statusCode, 403);
      assert.equal((await app.inject({ url: `${base}/customer-cards?q=Shira`, headers: worker })).statusCode, 403);
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.businessAccessEvent.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.deleteMany({ where: { id: { in: Object.values(people).map(p => p.id) } } });
  }
});

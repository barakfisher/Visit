import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { tokenDigest } from '../src/security/sessions.js';
import { STAFF_HAS_APPOINTMENTS } from '../src/repositories/provider-settings.js';
import { MAX_REPORTED_CONFLICTS } from '../src/repositories/TimeBlocks.service.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

type Listed = { id: string; displayName: string };
type Conflict = { kind: string; id: string; staffName: string; customerName: string | null; serviceName: string };

test('removing staff deletes, archives or refuses depending on their bookings', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Removal', slug: `removal-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const people = await Promise.all(['owner', 'manager', 'staff', 'outsider', 'customer'].map(role => prisma.identity.create({ data: { email: `removal-${role}-${run}@example.test` } })));
  const [owner, manager, staffMember, outsider, customer] = people;
  assert.ok(owner && manager && staffMember && outsider && customer);
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
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Cut', durationMinutes: 30 } });
  // The booking trigger refuses contact-less bookings under the default policy.
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  const resource = async (displayName: string) => {
    const staff = await prisma.staff.create({ data: { businessId: business.id, displayName } });
    await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
    await prisma.staffWeeklyAvailability.create({ data: { businessId: business.id, staffId: staff.id, weekday: 1, startLocal: '09:00', endLocal: '17:00' } });
    await prisma.timeBlock.create({ data: { businessId: business.id, staffId: staff.id, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000) } });
    return staff;
  };
  // An anchor keeps the business publishable, so removing the others never unpublishes it and bookings keep working.
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '08:00', endLocal: '18:00' })) });
  await resource('Anchor');
  const book = (staffId: string, startsAt: Date, status: 'CONFIRMED' | 'HELD' | 'CANCELLED' = 'CONFIRMED') => prisma.booking.create({ data: { businessId: business.id, staffId, serviceId: service.id, customerId: customer.id, serviceName: service.name, status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 300000) : null, idempotencyKey: randomUUID(), startsAt, endsAt: new Date(+startsAt + 1800000), occupiedFrom: startsAt, occupiedUntil: new Date(+startsAt + 1800000) } });
  const app = await createApp();
  const headers = (id = owner.id) => ({ authorization: `Bearer ${tokens.get(id)}`, 'x-visit-client': 'native' });
  const base = `/v1/provider/businesses/${business.id}/staff`;
  const remove = (staffId: string, id = owner.id) => app.inject({ method: 'DELETE', url: `${base}/${staffId}`, headers: headers(id) });
  const listed = async () => (await app.inject({ url: base, headers: headers() })).json<{ staff: Listed[] }>().staff.map(staff => staff.id);
  const day = 86400000;
  try {
    await t.test('only owners and managers remove staff, and only staff of this business', async () => {
      const kept = await resource('Kept');
      assert.equal((await remove(kept.id, staffMember.id)).statusCode, 403);
      assert.equal((await remove(kept.id, outsider.id)).statusCode, 403);
      assert.equal((await remove('missing')).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${kept.id}`, headers: { 'x-visit-client': 'native' } })).statusCode, 401);
      assert.ok(await prisma.staff.findFirst({ where: { id: kept.id, archivedAt: null } }));
      const removed = await remove(kept.id, manager.id);
      assert.equal(removed.statusCode, 200, removed.body);
    });

    await t.test('a staff member who never had a booking is deleted with their services, hours and blocks', async () => {
      const fresh = await resource('Fresh');
      const response = await remove(fresh.id);
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { deleted: true, archived: false });
      assert.equal(await prisma.staff.count({ where: { id: fresh.id } }), 0);
      assert.equal(await prisma.staffService.count({ where: { staffId: fresh.id } }), 0);
      assert.equal(await prisma.staffWeeklyAvailability.count({ where: { staffId: fresh.id } }), 0);
      assert.equal(await prisma.timeBlock.count({ where: { staffId: fresh.id } }), 0);
      assert.equal((await remove(fresh.id)).statusCode, 404);
    });

    await t.test('a staff member with only past bookings is archived: history stays, holds expire, every screen forgets them', async () => {
      const veteran = await resource('Veteran');
      const past = await book(veteran.id, new Date(Date.now() - 2 * day));
      const cancelled = await book(veteran.id, new Date(Date.now() + 3 * day), 'CANCELLED');
      const hold = await book(veteran.id, new Date(Date.now() + 4 * day), 'HELD');
      const response = await remove(veteran.id);
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { deleted: false, archived: true });
      const archived = await prisma.staff.findUniqueOrThrow({ where: { id: veteran.id } });
      assert.equal(archived.active, false);
      assert.ok(archived.archivedAt);
      assert.deepEqual((await prisma.booking.findMany({ where: { id: { in: [past.id, cancelled.id] } }, orderBy: { startsAt: 'asc' }, select: { status: true } })).map(row => row.status), ['CONFIRMED', 'CANCELLED']);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status, 'EXPIRED');
      assert.equal(await prisma.staffService.count({ where: { staffId: veteran.id } }), 0);
      assert.equal(await prisma.timeBlock.count({ where: { staffId: veteran.id } }), 0);
      assert.equal((await listed()).includes(veteran.id), false);
      assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${veteran.id}`, headers: headers(), payload: { active: true } })).statusCode, 404);
      assert.equal((await app.inject({ url: `${base}/${veteran.id}/availability-rules`, headers: headers() })).statusCode, 404);
      assert.equal((await prisma.staff.findUniqueOrThrow({ where: { id: veteran.id } })).active, false);
      assert.equal((await remove(veteran.id)).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/${veteran.id}/availability-rules/preview`, headers: headers(), payload: { weekly: [] } })).statusCode, 404);
      const linked = await app.inject({ method: 'POST', url: `/api/provider/services?businessId=${business.id}`, headers: headers(), payload: { name: 'Late service', durationMinutes: 15, staffIds: [veteran.id] } });
      assert.equal(linked.statusCode, 404, linked.body);
      assert.equal(await prisma.staffService.count({ where: { staffId: veteran.id } }), 0);
    });

    await t.test('replaying the creation request of a removed staff member is refused, not answered with the archived row', async () => {
      const creationKey = randomUUID(), input = { displayName: 'Returning', serviceIds: [service.id], creationKey };
      const created = await app.inject({ method: 'POST', url: base, headers: headers(), payload: input });
      assert.equal(created.statusCode, 201, created.body);
      const returningId = created.json<{ id: string }>().id;
      await book(returningId, new Date(Date.now() - day));
      assert.deepEqual((await remove(returningId)).json(), { deleted: false, archived: true });
      assert.equal((await app.inject({ method: 'POST', url: base, headers: headers(), payload: input })).statusCode, 409);
    });

    await t.test('a staff member with upcoming appointments is refused with an exact total and a capped list, and nothing changes', async () => {
      const busy = await resource('Busy');
      const extra = 3;
      for (let index = 0; index < MAX_REPORTED_CONFLICTS + extra; index += 1) await book(busy.id, new Date(Date.now() + (index + 1) * day));
      const hold = await book(busy.id, new Date(Date.now() + 40 * day), 'HELD');
      const response = await remove(busy.id);
      assert.equal(response.statusCode, 409, response.body);
      const body = response.json<{ error: { code: string; details: { total: number; timezone: string; conflicts: Conflict[] } } }>().error;
      assert.equal(body.code, STAFF_HAS_APPOINTMENTS);
      assert.equal(body.details.total, MAX_REPORTED_CONFLICTS + extra);
      assert.equal(body.details.timezone, business.timezone);
      assert.equal(body.details.conflicts.length, MAX_REPORTED_CONFLICTS);
      assert.deepEqual({ ...body.details.conflicts[0], id: undefined, startsAt: undefined, endsAt: undefined }, { kind: 'APPOINTMENT', id: undefined, startsAt: undefined, endsAt: undefined, staffName: 'Busy', customerName: 'Dana', serviceName: 'Cut' });
      const unchanged = await prisma.staff.findUniqueOrThrow({ where: { id: busy.id } });
      assert.deepEqual({ active: unchanged.active, archivedAt: unchanged.archivedAt }, { active: true, archivedAt: null });
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status, 'HELD');
      assert.equal(await prisma.staffService.count({ where: { staffId: busy.id } }), 1);
      assert.ok((await listed()).includes(busy.id));
    });

    await t.test('an appointment in progress still counts as upcoming', async () => {
      const working = await resource('Working');
      await book(working.id, new Date(Date.now() - 600000));
      const response = await remove(working.id);
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json<{ error: { details: { total: number } } }>().error.details.total, 1);
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.deleteMany({ where: { id: { in: people.map(person => person.id) } } });
  }
});

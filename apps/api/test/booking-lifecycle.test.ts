import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { MembershipRole } from '../src/generated/prisma/client.js';
import { tokenDigest } from '../src/security/sessions.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });
test('appointment lifecycle is authorized, append-only, idempotent and capacity preserving', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Lifecycle', slug: `lifecycle-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const foreignBusiness = await prisma.business.create({ data: { name: 'Foreign', slug: `lifecycle-foreign-${run}`, timezone: 'UTC', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const people = await Promise.all(['customer', 'owner', 'manager', 'staff', 'foreign'].map(role => prisma.identity.create({ data: { email: `${role}-${run}@example.test` } })));
  const [customer, owner, manager, staffIdentity, foreign] = people;
  assert.ok(customer && owner && manager && staffIdentity && foreign);
  const sessions = new Map<string, string>();
  for (const person of people) { const token = randomUUID(); sessions.set(person.id, token); await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } }); }
  await prisma.membership.createMany({ data: [{ identityId: owner.id, role: MembershipRole.OWNER }, { identityId: manager.id, role: MembershipRole.MANAGER }, { identityId: staffIdentity.id, role: MembershipRole.STAFF }].map(item => ({ ...item, businessId: business.id, status: 'ACTIVE' as const })) });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Historical consultation', durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Historical specialist' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  const headers = (identityId: string) => ({ authorization: `Bearer ${sessions.get(identityId)}`, 'x-visit-client': 'native' });
  let index = 0;
  const create = async (past = false, held = false) => {
    const startsAt = new Date(new Date(Date.now() + (past ? -4 : 2) * 86400000).setUTCHours(6 + index++, 0, 0, 0)), endsAt = new Date(+startsAt + 1800000);
    return prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: held ? 'HELD' : 'CONFIRMED', holdExpiresAt: held ? new Date(Date.now() + 300000) : null, idempotencyKey: randomUUID() } });
  };
  const app = await createApp();
  const outcome = (id: string) => `/v1/provider/businesses/${business.id}/bookings/${id}/outcome`;
  const events = (id: string) => prisma.bookingEvent.findMany({ where: { businessId: business.id, bookingId: id }, orderBy: { revision: 'asc' } });
  try {
    await t.test('only owners/managers can record ended outcomes; future, stale, forged and terminal transitions fail', async () => {
      const past = await create(true), future = await create();
      assert.equal((await app.inject({ method: 'POST', url: outcome(past.id), payload: { status: 'COMPLETED', expectedRevision: 0 } })).statusCode, 401);
      for (const person of [customer, staffIdentity, foreign]) assert.equal((await app.inject({ method: 'POST', url: outcome(past.id), headers: headers(person.id), payload: { status: 'COMPLETED', expectedRevision: 0 } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: outcome(future.id), headers: headers(owner.id), payload: { status: 'COMPLETED', expectedRevision: 0 } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: outcome(past.id), headers: headers(owner.id), payload: { status: 'COMPLETED', expectedRevision: 1 } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: outcome(past.id), headers: headers(owner.id), payload: { status: 'CONFIRMED', expectedRevision: 0 } })).statusCode, 400);
      const done = await app.inject({ method: 'POST', url: outcome(past.id), headers: headers(manager.id), payload: { status: 'COMPLETED', expectedRevision: 0 } }); assert.equal(done.statusCode, 200, done.body);
      const repeated = await app.inject({ method: 'POST', url: outcome(past.id), headers: headers(manager.id), payload: { status: 'COMPLETED', expectedRevision: 0 } }); assert.equal(repeated.statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: outcome(past.id), headers: headers(owner.id), payload: { status: 'NO_SHOW', expectedRevision: 1 } })).statusCode, 409);
      const audit = await events(past.id); assert.equal(audit.length, 2); assert.equal(audit[1]?.actorIdentityId, manager.id); assert.equal(audit[1]?.source, 'PROVIDER'); assert.equal(audit[1]?.reason, 'APPOINTMENT_FINISHED'); assert.equal(audit[1]?.oldStatus, 'CONFIRMED'); assert.equal(audit[1]?.newStatus, 'COMPLETED');
      await assert.rejects(prisma.booking.update({ where: { id: past.id }, data: { status: 'CONFIRMED' } }));
      await assert.rejects(prisma.booking.update({ where: { id: past.id }, data: { startsAt: new Date(+past.startsAt + 60000) } }));
      await assert.rejects(prisma.booking.update({ where: { id: future.id }, data: { status: 'NO_SHOW' } }));
    });
    await t.test('no-show and completed intervals still fence historical capacity and retain service snapshots', async () => {
      const booking = await create(true);
      const response = await app.inject({ method: 'POST', url: outcome(booking.id), headers: headers(owner.id), payload: { status: 'NO_SHOW', expectedRevision: 0 } }); assert.equal(response.statusCode, 200, response.body);
      await assert.rejects(prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, startsAt: booking.startsAt, endsAt: booking.endsAt, occupiedFrom: booking.occupiedFrom, occupiedUntil: booking.occupiedUntil, status: 'CONFIRMED', idempotencyKey: randomUUID() } }));
      await prisma.service.update({ where: { id: service.id }, data: { name: 'Changed catalog', priceMinor: 99900, durationMinutes: 60 } });
      const history = await app.inject({ url: '/v1/me/bookings', headers: headers(customer.id) }); assert.equal(history.statusCode, 200);
      const record = history.json().bookings.find((item: { id: string }) => item.id === booking.id);
      assert.equal(record.status, 'NO_SHOW'); assert.equal(record.service.name, 'Historical consultation'); assert.equal(record.service.durationMinutes, 30); assert.equal(record.service.priceMinor, 12500);
      await prisma.service.update({ where: { id: service.id }, data: { name: 'Historical consultation', durationMinutes: 30, priceMinor: 12500 } });
    });
    await t.test('event reads are owned/tenant-scoped and never reveal raw contact or actor credentials', async () => {
      const booking = await create();
      const url = `/v1/bookings/${booking.id}/history`;
      assert.equal((await app.inject({ url, headers: headers(foreign.id) })).statusCode, 404);
      assert.equal((await app.inject({ url })).statusCode, 401);
      const response = await app.inject({ url, headers: headers(customer.id) }); assert.equal(response.statusCode, 200);
      assert.equal(response.body.includes(customer.email ?? 'sensitive-marker'), false); assert.equal(response.body.includes('actorIdentityId'), false);
      assert.equal((await app.inject({ url: `/v1/provider/businesses/${foreignBusiness.id}/bookings/${booking.id}/history`, headers: headers(owner.id) })).statusCode, 403);
      assert.equal((await app.inject({ url: `/v1/provider/businesses/${business.id}/bookings/${booking.id}/history`, headers: headers(staffIdentity.id) })).statusCode, 403);
      await prisma.membership.updateMany({ where: { identityId: manager.id }, data: { status: 'REVOKED' } });
      assert.equal((await app.inject({ method: 'POST', url: outcome(booking.id), headers: headers(manager.id), payload: { status: 'NO_SHOW', expectedRevision: 0 } })).statusCode, 403);
      await prisma.membership.updateMany({ where: { identityId: manager.id }, data: { status: 'ACTIVE' } });
    });
    await t.test('audit rows reject direct insertion/update/deletion; only privileged parent purge cascades', async () => {
      const booking = await create(), audit = (await events(booking.id))[0]; assert.ok(audit);
      await assert.rejects(prisma.bookingEvent.update({ where: { id: audit.id }, data: { reason: 'SYSTEM_CHANGE' } }));
      await assert.rejects(prisma.bookingEvent.delete({ where: { id: audit.id } }));
      await assert.rejects(prisma.bookingEvent.create({ data: { businessId: business.id, bookingId: booking.id, revision: 99, kind: 'CREATED', source: 'SYSTEM', reason: 'SYSTEM_CHANGE', newStatus: 'CONFIRMED', newStartsAt: booking.startsAt, newEndsAt: booking.endsAt, newStaffId: staff.id } }));
      await prisma.booking.delete({ where: { id: booking.id } }); assert.equal((await events(booking.id)).length, 0);
    });
    await t.test('concurrent terminal decisions serialize to one event; retry cannot replace an outcome', async () => {
      const booking = await create(true);
      const replies = await Promise.all(['COMPLETED', 'NO_SHOW'].map(status => app.inject({ method: 'POST', url: outcome(booking.id), headers: headers(owner.id), payload: { status, expectedRevision: 0 } })));
      assert.deepEqual(replies.map(reply => reply.statusCode).sort(), [200, 409]); assert.equal((await events(booking.id)).length, 2);
      const next = await create(true);
      const cancel = `/v1/provider/businesses/${business.id}/bookings/${next.id}/cancel`;
      const race = await Promise.all([app.inject({ method: 'POST', url: cancel, headers: headers(owner.id), payload: { expectedRevision: 0 } }), app.inject({ method: 'POST', url: outcome(next.id), headers: headers(manager.id), payload: { status: 'COMPLETED', expectedRevision: 0 } })]);
      assert.deepEqual(race.map(reply => reply.statusCode).sort(), [200, 409]); assert.equal((await events(next.id)).length, 2);
    });
    await t.test('explicit final consent creates one attributed event and ended recovery never commits again', async () => {
      const startsAt = new Date(new Date(Date.now() + 20 * 86400000).setUTCHours(9, 0, 0, 0)).toISOString();
      const payload = { finalConsent: true, providerId: business.id, serviceId: service.id, staffId: staff.id, startsAt, idempotencyKey: randomUUID(), reviewedService: { name: 'Historical consultation', durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } };
      const response = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers: headers(customer.id), payload }); assert.equal(response.statusCode, 200, response.body);
      const id: string = response.json().id;
      const created = await events(id); assert.equal(created.length, 1); assert.equal(created[0]?.kind, 'CREATED'); assert.equal(created[0]?.actorIdentityId, customer.id); assert.equal(created[0]?.source, 'CUSTOMER'); assert.equal(created[0]?.reason, 'FINAL_CONSENT');
      assert.equal((await app.inject({ method: 'POST', url: '/api/bookings/commit', headers: headers(customer.id), payload })).statusCode, 200); assert.equal((await events(id)).length, 1);
      const pastStart = new Date(new Date(Date.now() - 7 * 86400000).setUTCHours(9, 0, 0, 0)), pastEnd = new Date(+pastStart + 1800000);
      const historical = await prisma.booking.update({ where: { id }, data: { startsAt: pastStart, endsAt: pastEnd, occupiedFrom: pastStart, occupiedUntil: pastEnd } });
      assert.equal((await app.inject({ method: 'POST', url: outcome(id), headers: headers(owner.id), payload: { status: 'COMPLETED', expectedRevision: historical.revision } })).statusCode, 200);
      const count = await prisma.booking.count({ where: { businessId: business.id } });
      const recovered = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers: headers(customer.id), payload }); assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().status, 'COMPLETED'); assert.equal(recovered.json().id, id);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), count); assert.equal((await events(id)).filter(event => event.kind === 'CREATED').length, 1);
    });
    await t.test('reschedule records exact old/new instants and a duplicate unchanged move creates no event', async () => {
      const booking = await create(), startsAt = new Date(+booking.startsAt + 7 * 86400000).toISOString();
      const request = { method: 'POST' as const, url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(customer.id), payload: { staffId: staff.id, startsAt } };
      const response = await app.inject(request); assert.equal(response.statusCode, 200, response.body);
      const audit = await events(booking.id); assert.equal(audit.length, 2); assert.equal(audit[1]?.oldStartsAt?.toISOString(), booking.startsAt.toISOString()); assert.equal(audit[1]?.newStartsAt.toISOString(), startsAt); assert.equal(audit[1]?.kind, 'RESCHEDULED'); assert.equal(audit[1]?.actorIdentityId, customer.id);
      assert.equal((await app.inject(request)).statusCode, 200); assert.equal((await events(booking.id)).length, 2);
    });
    await t.test('customer cancel versus reschedule preserves one revision; provisional holds never enter history', async () => {
      const booking = await create(), startsAt = new Date(+booking.startsAt + 7 * 86400000).toISOString();
      const race = await Promise.all([app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/cancel`, headers: headers(customer.id), payload: { expectedRevision: 0 } }), app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(customer.id), payload: { staffId: staff.id, startsAt } })]);
      assert.deepEqual(race.map(reply => reply.statusCode).sort(), [200, 409]);
      const audit = await events(booking.id); assert.equal(audit.length, 2); assert.equal(audit[1]?.actorIdentityId, customer.id); assert.equal(audit[1]?.source, 'CUSTOMER');
      const held = await create(false, true);
      assert.equal((await events(held.id)).length, 0);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${held.id}/cancel`, headers: headers(customer.id) })).statusCode, 200);
      assert.equal((await events(held.id)).length, 0);
      const history = await app.inject({ url: '/v1/me/bookings', headers: headers(customer.id) }); assert.equal(history.json().bookings.some((item: { id: string }) => item.id === held.id), false);
    });
  } finally { await app.close(); await prisma.booking.deleteMany({ where: { businessId: business.id } }); await prisma.business.deleteMany({ where: { id: { in: [business.id, foreignBusiness.id] } } }); await prisma.identity.deleteMany({ where: { id: { in: people.map(person => person.id) } } }); }
});

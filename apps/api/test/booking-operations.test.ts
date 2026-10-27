import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { tokenDigest } from '../src/security/sessions.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

test('reschedule and cancellation preserve atomic capacity, ownership and lifecycle intent', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Operations QA', slug: `operations-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const foreignBusiness = await prisma.business.create({ data: { name: 'Foreign QA', slug: `foreign-operations-${run}`, timezone: 'UTC', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const people = await Promise.all(['customer', 'foreign', 'owner', 'staff'].map(role => prisma.identity.create({ data: { email: `${role}-${run}@example.test` } })));
  const [customer, foreign, owner, staffIdentity] = people;
  assert.ok(customer && foreign && owner && staffIdentity);
  const tokens = new Map<string, string>();
  for (const person of people) {
    const token = randomUUID(); tokens.set(person.id, token);
    await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  }
  await prisma.membership.createMany({ data: [{ businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' }, { businessId: business.id, identityId: staffIdentity.id, role: 'STAFF', status: 'ACTIVE' }] });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Original snapshot', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'QA specialist' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  const app = await createApp();
  const headers = (id = customer.id) => ({ authorization: `Bearer ${tokens.get(id)}`, 'x-visit-client': 'native' });
  let day = 2;
  const create = async () => {
    const startsAt = new Date(new Date(Date.now() + day++ * 86400000).setUTCHours(8, 0, 0, 0));
    const endsAt = new Date(+startsAt + 1800000);
    return prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, status: 'CONFIRMED', startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: randomUUID() } });
  };
  const payload = (startsAt: Date, expectedRevision = 0) => ({ finalConsent: true, expectedRevision, staffId: staff.id, startsAt: startsAt.toISOString(), idempotencyKey: randomUUID() });
  const notifications = (bookingId: string) => prisma.bookingNotification.findMany({ where: { bookingId } });
  const unchanged = async (booking: Awaited<ReturnType<typeof create>>) => {
    const current = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(current.startsAt.toISOString(), booking.startsAt.toISOString()); assert.equal(current.status, 'CONFIRMED'); assert.equal(current.revision, 0);
    assert.equal(await prisma.bookingReschedule.count({ where: { bookingId: booking.id } }), 0);
    assert.equal((await notifications(booking.id)).length, 1);
  };
  try {
    await t.test('foreign identity, staff role, revoked session and missing final consent cannot mutate', async () => {
      const booking = await create(); const body = payload(new Date(+booking.startsAt + 3600000));
      const url = `/v1/bookings/${booking.id}/reschedule`;
      assert.equal((await app.inject({ method: 'POST', url, headers: headers(foreign.id), payload: body })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/provider/businesses/${business.id}/bookings/${booking.id}/reschedule`, headers: headers(staffIdentity.id), payload: body })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: { ...body, finalConsent: false } })).statusCode, 400);
      await prisma.session.updateMany({ where: { identityId: foreign.id }, data: { revokedAt: new Date() } });
      assert.equal((await app.inject({ method: 'POST', url, headers: headers(foreign.id), payload: body })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/cancel`, headers: headers(owner.id), payload: { expectedRevision: 0 } })).statusCode, 404);
      for (const invalid of [null, {}, { ...body, staffId: '' }, { ...body, expectedRevision: -1 }, { ...body, startsAt: 'invalid' }, { ...body, localDate: '2026-10-30', localTime: '09:00' }]) {
        assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers(), 'content-type': 'application/json' }, payload: JSON.stringify(invalid) })).statusCode, 400);
      }
      await unchanged(booking);
    });
    await t.test('provider owner is tenant scoped and can reschedule and cancel with attributed audit', async () => {
      const booking = await create(); const body = payload(new Date(+booking.startsAt + 3600000));
      const base = `/v1/provider/businesses/${business.id}/bookings/${booking.id}`;
      assert.equal((await app.inject({ method: 'POST', url: `/v1/provider/businesses/${foreignBusiness.id}/bookings/${booking.id}/reschedule`, headers: headers(owner.id), payload: body })).statusCode, 403);
      await prisma.membership.create({ data: { businessId: foreignBusiness.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
      assert.equal((await app.inject({ method: 'POST', url: `/v1/provider/businesses/${foreignBusiness.id}/bookings/${booking.id}/reschedule`, headers: headers(owner.id), payload: body })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/reschedule`, headers: headers(owner.id), payload: body })).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/cancel`, headers: headers(owner.id), payload: { expectedRevision: 1 } })).statusCode, 200);
      const events = await prisma.bookingEvent.findMany({ where: { bookingId: booking.id, revision: { gt: 0 } } });
      assert.equal(events.length, 2);
      assert.ok(events.every(event => event.source === 'PROVIDER' && event.actorIdentityId === owner.id && event.reason === 'PROVIDER_REQUEST'));
    });
    await t.test('database failure after booking write rolls back capacity, event and notification', async () => {
      const booking = await create(); const body = payload(new Date(+booking.startsAt + 3600000));
      // Names and the row predicate originate exclusively from generated fixture identifiers.
      const name = `qa_reschedule_${randomUUID().replaceAll('-', '')}`;
      const rowId = booking.id.replaceAll("'", "''");
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."bookingId" = '${rowId}' THEN RAISE EXCEPTION 'QA_RESCHEDULE_ROLLBACK'; END IF; RETURN NEW; END $$`);
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "BookingReschedule" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
        try {
          const reply = await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(), payload: body });
          assert.equal(reply.statusCode, 500, reply.body); await unchanged(booking);
          assert.equal(await prisma.bookingEvent.count({ where: { bookingId: booking.id } }), 1);
        } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "BookingReschedule"`); }
      } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`); }
      // The failed transaction's Redis lease must also be released for an immediate identical retry.
      const retry = await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(), payload: body });
      assert.equal(retry.statusCode, 200, retry.body);
      assert.equal((await notifications(booking.id)).length, 2);
    });
    await t.test('duplicate concurrent moves create exactly one revision and notification; key reuse rejects changed destination', async () => {
      const booking = await create(); const body = payload(new Date(+booking.startsAt + 3600000));
      const request = { method: 'POST' as const, url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(), payload: body };
      const replies = await Promise.all([app.inject(request), app.inject(request)]);
      assert.deepEqual(replies.map(reply => reply.statusCode), [200, 200]);
      assert.equal(await prisma.bookingReschedule.count({ where: { bookingId: booking.id } }), 1);
      assert.equal((await notifications(booking.id)).filter(row => row.kind === 'BOOKING_RESCHEDULED').length, 1);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).revision, 1);
      assert.equal((await app.inject({ ...request, payload: { ...body, startsAt: new Date(+booking.startsAt + 7200000).toISOString() } })).statusCode, 409);
      const cancel = { method: 'POST' as const, url: `/v1/bookings/${booking.id}/cancel`, headers: headers(), payload: { expectedRevision: 1 } };
      const cancelled = await Promise.all([app.inject(cancel), app.inject(cancel)]);
      assert.deepEqual(cancelled.map(reply => reply.statusCode), [200, 200]);
      assert.equal((await notifications(booking.id)).filter(row => row.kind === 'BOOKING_CANCELLED').length, 1);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).revision, 2);
      // Recovery must never recreate capacity or replay lifecycle effects after cancellation.
      const recovery = await app.inject(request); assert.equal(recovery.statusCode, 200); assert.equal(recovery.json().status, 'CANCELLED');
      assert.equal((await notifications(booking.id)).length, 3);
      const replacementStart = new Date(body.startsAt), replacementEnd = new Date(+replacementStart + 1800000);
      const replacement = await prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, status: 'CONFIRMED', startsAt: replacementStart, endsAt: replacementEnd, occupiedFrom: replacementStart, occupiedUntil: replacementEnd, idempotencyKey: randomUUID() } });
      assert.equal(replacement.status, 'CONFIRMED');
      const retry = await app.inject(cancel); assert.equal(retry.statusCode, 200);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacement.id } })).status, 'CONFIRMED');
    });
    await t.test('destination conflict and current contact or cutoff failures preserve original booking', async () => {
      const booking = await create(), occupied = await create();
      const url = `/v1/bookings/${booking.id}/reschedule`;
      assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: payload(occupied.startsAt) })).statusCode, 409); await unchanged(booking);
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { requireVerifiedPhone: true } });
      const contact = await app.inject({ method: 'POST', url, headers: headers(), payload: payload(new Date(+booking.startsAt + 3600000)) });
      assert.equal(contact.statusCode, 409); assert.equal(contact.json().error.code, 'CUSTOMER_CONTACT_REQUIRED'); await unchanged(booking);
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { requireVerifiedPhone: false, rescheduleCutoffMinutes: 50000, cancellationCutoffMinutes: 50000 } });
      assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: payload(new Date(+booking.startsAt + 3600000)) })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/cancel`, headers: headers(), payload: { expectedRevision: 0 } })).statusCode, 409); await unchanged(booking);
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { rescheduleCutoffMinutes: 0, cancellationCutoffMinutes: 0 } });
    });
    await t.test('missing cancellation policy fails closed and preserves the confirmed booking', async () => {
      const booking = await create();
      const policy = await prisma.bookingPolicy.delete({ where: { businessId: business.id } });
      try {
        const details = await app.inject({ url: `/v1/bookings/${booking.id}/details`, headers: headers() });
        assert.equal(details.statusCode, 200); assert.equal(details.json().actions.canCancel, false);
        const cancel = await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/cancel`, headers: headers(), payload: { expectedRevision: 0 } });
        assert.equal(cancel.statusCode, 409, cancel.body); await unchanged(booking);
      } finally { await prisma.bookingPolicy.create({ data: policy }); }
    });
    await t.test('archived service reschedules retain immutable duration and price', async () => {
      const booking = await create();
      await prisma.service.update({ where: { id: service.id }, data: { active: false, durationMinutes: 90, name: 'Replaced catalog', priceMinor: 20000 } });
      const reply = await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(), payload: payload(new Date(+booking.startsAt + 3600000)) });
      assert.equal(reply.statusCode, 200, reply.body);
      const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      assert.equal(+updated.endsAt - +updated.startsAt, 1800000); assert.equal(updated.serviceDurationMinutes, 30); assert.equal(updated.servicePriceMinor, 10000); assert.equal(updated.serviceName, 'Original snapshot');
      await prisma.service.update({ where: { id: service.id }, data: { active: true, durationMinutes: 30, name: 'Original snapshot', priceMinor: 10000 } });
    });
    await t.test('Redis outage and lost provisional ownership roll back the entire move', async () => {
      for (const failure of ['outage', 'expiry'] as const) {
        const booking = await create();
        const originalEval = redis.eval.bind(redis);
        const stub = t.mock.method(redis, 'eval', async (...args: Parameters<typeof redis.eval>) => {
          if (failure === 'outage') throw new Error('QA reservation transport failure');
          // Force ownership revalidation to fail after a real successful provisional acquisition.
          if (String(args[0]).includes('local expiry')) return 0;
          return originalEval(...args);
        });
        try {
          const reply = await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/reschedule`, headers: headers(), payload: payload(new Date(+booking.startsAt + 3600000)) });
          assert.equal(reply.statusCode, failure === 'outage' ? 503 : 409, reply.body); await unchanged(booking);
        } finally { stub.mock.restore(); }
      }
    });
  } finally {
    await app.close(); await prisma.booking.deleteMany({ where: { businessId: business.id } }); await prisma.business.deleteMany({ where: { id: { in: [business.id, foreignBusiness.id] } } }); await prisma.identity.deleteMany({ where: { id: { in: people.map(person => person.id) } } });
  }
});

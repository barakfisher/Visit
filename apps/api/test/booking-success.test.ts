import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { tokenDigest } from '../src/security/sessions.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });
test('owned persisted success and notification intent exist only after committed creation', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Persisted studio', slug: `success-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const customer = await prisma.identity.create({ data: { email: `success-${run}@example.test` } }), foreign = await prisma.identity.create({ data: { email: `success-foreign-${run}@example.test` } });
  const token = randomUUID(), otherToken = randomUUID();
  await prisma.session.createMany({ data: [{ identityId: customer.id, tokenHash: tokenDigest(token) }, { identityId: foreign.id, tokenHash: tokenDigest(otherToken) }].map(row => ({ ...row, expiresAt: new Date(Date.now() + 600000) })) });
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' }, foreignHeaders = { authorization: `Bearer ${otherToken}`, 'x-visit-client': 'native' };
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Persisted consultation', durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } }), staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Persisted specialist' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 60, rescheduleCutoffMinutes: 120 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const create = (hour: number, status: 'HELD' | 'EXPIRED' | 'CONFIRMED' = 'CONFIRMED') => { const startsAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`), endsAt = new Date(+startsAt + 1800000); return prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 300000) : null, idempotencyKey: randomUUID() } }); };
  const app = await createApp();
  try {
    await t.test('missing/foreign/provisional IDs never expose success, calendar or notifications', async () => {
      for (const status of ['HELD', 'EXPIRED'] as const) {
        const booking = await create(status === 'HELD' ? 7 : 8, status);
        assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/details`, headers })).statusCode, 404);
        assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/calendar?revision=0`, headers })).statusCode, 404);
        assert.equal(await prisma.bookingNotification.count({ where: { businessId: business.id, bookingId: booking.id } }), 0);
      }
      const booking = await create(9);
      assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/details` })).statusCode, 401);
      for (const path of ['details', 'calendar?revision=0']) assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/${path}`, headers: foreignHeaders })).statusCode, 404);
      assert.equal((await app.inject({ url: '/v1/bookings/missing/details', headers })).statusCode, 404);
      const response = await app.inject({ url: `/v1/bookings/${booking.id}/details`, headers }); assert.equal(response.statusCode, 200, response.body);
      const details = response.json(); assert.equal(details.status, 'CONFIRMED'); assert.equal(details.service.name, 'Persisted consultation'); assert.equal(details.service.priceMinor, 12500); assert.equal(details.business.timezone, 'Asia/Jerusalem'); assert.equal(details.notification.status, 'RECORDED'); assert.equal(details.notification.sms, 'UNSUPPORTED'); assert.equal(details.notification.whatsapp, 'UNSUPPORTED');
      for (const secret of [customer.email, 'customerId', 'idempotencyKey', 'tokenHash', 'customerPhone', 'actorIdentityId']) if (secret) assert.equal(response.body.includes(secret), false);
      assert.equal(response.headers['cache-control'], 'no-store');
      const calendar = await app.inject({ url: `/v1/bookings/${booking.id}/calendar?revision=0`, headers }); assert.equal(calendar.statusCode, 200, calendar.body); assert.match(calendar.json().body, new RegExp(`UID:${booking.id}@visit.app`));
      assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/calendar?revision=1`, headers })).statusCode, 409);
      for (const query of ['', '?revision=', '?revision=01', '?revision=1e0', '?revision=-1', '?revision=1.5', '?revision=0&customerId=forged']) assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/calendar${query}`, headers })).statusCode, 400);
    });
    await t.test('revisits are read-only and current snapshots survive catalog edits/unpublishing; cancellation blocks export', async () => {
      const booking = await create(10);
      await prisma.service.update({ where: { id: service.id }, data: { name: 'Changed service', priceMinor: 99000, durationMinutes: 60, active: false } });
      await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } });
      const before = await prisma.bookingNotification.count({ where: { businessId: business.id } });
      const first = await app.inject({ url: `/v1/bookings/${booking.id}/calendar?revision=0`, headers }); assert.equal(first.statusCode, 200, first.body);
      assert.match(first.json().body, /SUMMARY:Persisted consultation at Persisted studio/);
      assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/calendar?revision=0`, headers })).body, first.body);
      const details = await app.inject({ url: `/v1/bookings/${booking.id}/details`, headers }); assert.equal(details.statusCode, 200); assert.equal(details.json().service.durationMinutes, 30); assert.equal(details.json().actions.canCancel, true);
      assert.equal(await prisma.bookingNotification.count({ where: { businessId: business.id } }), before);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/cancel`, headers, payload: { expectedRevision: 0 } })).statusCode, 200);
      assert.equal((await app.inject({ url: `/v1/bookings/${booking.id}/calendar?revision=1`, headers })).statusCode, 409);
      const cancelled = await app.inject({ url: `/v1/bookings/${booking.id}/details`, headers }); assert.equal(cancelled.json().status, 'CANCELLED'); assert.deepEqual(cancelled.json().actions, { canExport: false, canCancel: false, canReschedule: false });
      await prisma.service.update({ where: { id: service.id }, data: { name: 'Persisted consultation', priceMinor: 12500, durationMinutes: 30, active: true } }); await prisma.business.update({ where: { id: business.id }, data: { publishedAt: new Date() } });
    });
    await t.test('final-consent retries deduplicate committed notification intent and reject stale service review', async () => {
      const payload = { finalConsent: true, providerId: business.id, serviceId: service.id, staffId: staff.id, startsAt: `${date}T12:00:00Z`, idempotencyKey: randomUUID(), reviewedService: { name: service.name, durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } };
      const before = await prisma.bookingNotification.count({ where: { businessId: business.id } });
      const failed = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers, payload: { ...payload, idempotencyKey: randomUUID(), reviewedService: { ...payload.reviewedService, priceMinor: 1 } } }); assert.equal(failed.statusCode, 409); assert.equal(await prisma.bookingNotification.count({ where: { businessId: business.id } }), before);
      const response = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers, payload }); assert.equal(response.statusCode, 200, response.body);
      const id: string = response.json().id;
      for (const retry of await Promise.all([1, 2, 3].map(() => app.inject({ method: 'POST', url: '/api/bookings/commit', headers, payload })))) { if (retry.statusCode === 409) assert.equal(retry.json().error.code, 'ATTEMPT_PENDING'); else { assert.equal(retry.statusCode, 200, retry.body); assert.equal(retry.json().id, id); } }
      const recovered = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers, payload }); assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().id, id);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: payload.idempotencyKey } }), 1);
      const notices = await prisma.bookingNotification.findMany({ where: { businessId: business.id, bookingId: id }, include: { event: true } }); assert.equal(notices.length, 1); assert.equal(notices[0]?.event.kind, 'CREATED'); assert.equal(notices[0]?.event.newStatus, 'CONFIRMED'); assert.equal(notices[0]?.event.actorIdentityId, customer.id);
    });
    await t.test('notification recording rolls back with booking creation and rejects forged/mutable records', async () => {
      const key = randomUUID(), startsAt = new Date(`${date}T14:00:00Z`), endsAt = new Date(+startsAt + 1800000);
      const before = await prisma.bookingNotification.count({ where: { businessId: business.id } });
      await assert.rejects(prisma.$transaction(async tx => { await tx.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', idempotencyKey: key } }); throw new Error('Synthetic rollback'); }));
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: key } }), 0); assert.equal(await prisma.bookingNotification.count({ where: { businessId: business.id } }), before);
      const notice = await prisma.bookingNotification.findFirstOrThrow({ where: { businessId: business.id } });
      await assert.rejects(prisma.bookingNotification.update({ where: { id: notice.id }, data: { kind: 'FORGED' } }));
      await assert.rejects(prisma.bookingNotification.delete({ where: { id: notice.id } }));
      await assert.rejects(prisma.bookingNotification.create({ data: { businessId: business.id, bookingId: notice.bookingId, eventId: notice.eventId } }));
    });
  } finally { await app.close(); await prisma.booking.deleteMany({ where: { businessId: business.id } }); await prisma.business.delete({ where: { id: business.id } }); await prisma.identity.deleteMany({ where: { id: { in: [customer.id, foreign.id] } } }); }
});

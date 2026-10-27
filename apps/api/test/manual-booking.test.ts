import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { tokenDigest } from '../src/security/sessions.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { saveBusinessAvailability } from '../src/repositories/provider-settings.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { releaseHold } from '../src/scheduling/reservations.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });
test('manual bookings enforce contact exceptions and authoritative scheduling without creating identities', async t => {
 const key = randomUUID(), token = randomUUID();
 const owner = await prisma.identity.create({ data: { email: `manual-${key}@example.test` } });
 const matchingIdentity = await prisma.identity.create({ data: { phone: '+12025550123', phoneVerifiedAt: new Date() } });
 const business = await prisma.business.create({ data: { slug: `manual-${key}`, name: 'Manual appointments', timezone: 'America/New_York', approvalStatus: 'APPROVED', publishedAt: new Date() } });
 const membership = await prisma.membership.create({ data: { businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
 const session = await prisma.session.create({ data: { identityId: owner.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
 await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0, bufferBeforeMinutes: 10, bufferAfterMinutes: 10, requireVerifiedPhone: true } });
 const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Specialist', parallelCapacity: 1 } });
 const service = await prisma.service.create({ data: { businessId: business.id, name: 'Consultation', durationMinutes: 30, priceMinor: 10000, currency: 'USD' } });
 await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
 await saveBusinessAvailability(await requireBusinessMembership(owner.id, business.id), { weekly: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ startLocal: '08:00', endLocal: '18:00' }] })), overrides: [] });
 const app = Fastify();
 app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INVALID' } }));
 await registerProviderRoutes(app); await registerBookingRoutes(app);
 const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' }, url = `/v1/provider/businesses/${business.id}/manual-bookings`;
 const payload = (time = '10:00') => ({ finalConsent: true, idempotencyKey: randomUUID(), serviceId: service.id, staffId: staff.id, localDate: '2027-03-15', localTime: time, customerName: 'Unregistered customer', customerPhone: '+12025550123', exceptionReason: 'Requested by telephone', reviewedService: { name: service.name, durationMinutes: 30, priceMinor: 10000, currency: 'USD' } });
 const post = (body: object) => app.inject({ method: 'POST', url, headers, payload: body });
 try {
  await t.test('requires session, correct tenant/role and strict contact input', async () => {
   assert.equal((await app.inject({ method: 'POST', url, payload: payload() })).statusCode, 401);
   assert.equal((await app.inject({ method: 'POST', url: '/v1/provider/businesses/foreign/manual-bookings', headers, payload: payload() })).statusCode, 403);
   await prisma.membership.update({ where: { id: membership.id }, data: { role: 'STAFF' } }); assert.equal((await post(payload())).statusCode, 403);
   await prisma.membership.update({ where: { id: membership.id }, data: { role: 'OWNER' } });
   for (const patch of [{ customerId: owner.id }, { source: 'CUSTOMER' }, { customerPhoneVerifiedAt: new Date().toISOString() }, { finalConsent: false }, { customerPhone: '2025550123' }, { customerName: ' ' }, { customerEmail: 'broken' }, { exceptionReason: '' }]) assert.equal((await post({ ...payload(), ...patch })).statusCode, 400, JSON.stringify(patch));
   const missing = payload(); const { exceptionReason: _reason, ...withoutReason } = missing; assert.equal((await post(withoutReason)).statusCode, 400);
   await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }); assert.equal((await post(payload())).statusCode, 401);
   await prisma.session.update({ where: { id: session.id }, data: { revokedAt: null } });
  });
  await t.test('options expose assigned resources and no customer directory', async () => {
   const response = await app.inject({ url: `/v1/provider/businesses/${business.id}/manual-booking-options`, headers });
   assert.equal(response.statusCode, 200); const result = response.json<{ requiresException: boolean; services: { staff: { id: string }[] }[] }>();
   assert.equal(result.requiresException, true); assert.equal(result.services[0]?.staff[0]?.id, staff.id); assert.equal(response.body.includes(matchingIdentity.id), false);
  });
  await t.test('new contact remains unlinked/unverified, audit is immutable and replay uses exact fingerprint', async () => {
   const customerEmail = `manual-guest-${key}@example.test`, input = { ...payload(), customerEmail };
   assert.equal(await prisma.identity.count({ where: { email: customerEmail } }), 0);
   const response = await post(input); assert.equal(response.statusCode, 200, response.body);
   const result = response.json<{ id: string; contactVerification: string; notification: string; source: string }>();
   assert.equal(result.source, 'MANUAL'); assert.equal(result.contactVerification, 'UNVERIFIED'); assert.equal(result.notification, 'NOT_SENT');
   const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.id } });
   assert.equal(booking.customerId, null); assert.equal(booking.customerPhoneVerifiedAt, null); assert.equal(booking.customerEmailVerifiedAt, null); assert.equal(booking.enteredByIdentityId, owner.id); assert.ok(booking.customerContactCapturedAt);
   assert.deepEqual(await prisma.identity.findMany({ where: { phone: input.customerPhone }, select: { id: true } }), [{ id: matchingIdentity.id }]);
   assert.equal(await prisma.identity.count({ where: { email: customerEmail } }), 0);
   assert.equal(booking.customerEmail, customerEmail); assert.equal(await prisma.bookingNotification.count({ where: { bookingId: result.id } }), 0);
   const events = await prisma.bookingEvent.findMany({ where: { bookingId: result.id } }); assert.equal(events.length, 1); assert.equal(events[0]?.source, 'MANUAL'); assert.equal(events[0]?.reason, 'MANUAL_CONTACT_EXCEPTION');
   const audit = events[0]; assert.ok(audit); await assert.rejects(prisma.bookingEvent.update({ where: { id: audit.id }, data: { reason: 'SYSTEM_CHANGE' } }));
   assert.equal((await post(input)).json<{ id: string }>().id, result.id); assert.equal((await post({ ...input, customerName: 'Different contact' })).statusCode, 409);
   await assert.rejects(prisma.booking.update({ where: { id: result.id }, data: { customerPhone: '+12025550124' } }));
   await assert.rejects(prisma.booking.update({ where: { id: result.id }, data: { source: 'CUSTOMER', customerId: owner.id } }));
   for (const request of [{ method: 'GET' as const, url: `/v1/bookings/${result.id}/details` }, { method: 'POST' as const, url: `/v1/bookings/${result.id}/confirm`, payload: {} }, { method: 'POST' as const, url: `/v1/bookings/${result.id}/cancel`, payload: { expectedRevision: 0 } }]) {
    const denied = await app.inject({ ...request, headers }); assert.equal(denied.statusCode, 404, denied.body);
   }
   const movedTime = '2027-03-15T16:00:00.000Z';
   const moved = await app.inject({ method: 'POST', url: `/v1/provider/businesses/${business.id}/bookings/${result.id}/reschedule`, headers, payload: { finalConsent: true, idempotencyKey: randomUUID(), expectedRevision: 0, staffId: staff.id, startsAt: movedTime } });
   assert.equal(moved.statusCode, 200, moved.body);
   const replay = await post(input); assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json<{ startsAt: string }>().startsAt, movedTime);
   const cancelled = await app.inject({ method: 'POST', url: `/v1/provider/businesses/${business.id}/bookings/${result.id}/cancel`, headers, payload: { expectedRevision: moved.json<{ revision: number }>().revision } });
   assert.equal(cancelled.statusCode, 200, cancelled.body);
   assert.equal(await prisma.bookingNotification.count({ where: { bookingId: result.id } }), 0);
   assert.equal((await post(input)).json<{ status: string }>().status, 'CANCELLED'); assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 1);
  });
  await t.test('simultaneous same-attempt submissions create one audited appointment', async () => {
   const input = payload('15:00'), responses = await Promise.all([post(input), post(input), post(input), post(input)]);
   for (const response of responses) assert.equal(response.statusCode, 200, response.body);
   const id = responses[0]?.json<{ id: string }>().id; assert.ok(id); for (const response of responses) assert.equal(response.json<{ id: string }>().id, id);
   assert.equal(await prisma.bookingEvent.count({ where: { bookingId: id } }), 1);
  });
  await t.test('capacity buffers, blocked intervals, assignment, service review and publication cannot be overridden', async () => {
   const first = await post(payload('11:00')); assert.equal(first.statusCode, 200, first.body);
   assert.equal((await post(payload('11:30'))).statusCode, 409);
   assert.equal((await post({ ...payload('12:30'), staffId: 'foreign' })).statusCode, 404);
   assert.equal((await post({ ...payload('12:30'), reviewedService: { ...payload().reviewedService, name: 'Stale name' } })).statusCode, 409);
   assert.equal((await post(payload('07:50'))).statusCode, 409);
   const block = await prisma.timeBlock.create({ data: { businessId: business.id, staffId: staff.id, startsAt: new Date('2027-03-15T17:00:00Z'), endsAt: new Date('2027-03-15T18:00:00Z') } });
   assert.equal((await post(payload('13:00'))).statusCode, 409); await prisma.timeBlock.delete({ where: { id: block.id } });
   await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } }); assert.equal((await post(payload('14:00'))).statusCode, 409);
   await prisma.business.update({ where: { id: business.id }, data: { publishedAt: new Date() } });
   await prisma.staff.update({ where: { id: staff.id }, data: { active: false } }); assert.equal((await post(payload('14:00'))).statusCode, 404);
   await prisma.staff.update({ where: { id: staff.id }, data: { active: true } });
  });
  await t.test('a rejected attempt cannot commit after its scheduling conflict disappears', async () => {
   const input = payload('16:00');
   const block = await prisma.timeBlock.create({ data: { businessId: business.id, staffId: staff.id, startsAt: new Date('2027-03-15T20:00:00Z'), endsAt: new Date('2027-03-15T20:30:00Z') } });
   const rejected = await post(input); assert.equal(rejected.statusCode, 409, rejected.body);
   await prisma.timeBlock.delete({ where: { id: block.id } });
   const repeated = await post(input); assert.equal(repeated.statusCode, 409, repeated.body);
   assert.equal(await prisma.booking.count({ where: { businessId: business.id, idempotencyKey: `manual:${owner.id}:${input.idempotencyKey}` } }), 0);
   const fresh = await post({ ...input, idempotencyKey: randomUUID() }); assert.equal(fresh.statusCode, 200, fresh.body);
  });
  await t.test('DST gaps and folds reject before any scheduling override is considered', async () => {
   for (const [localDate, localTime] of [['2027-03-14', '02:30'], ['2027-11-07', '01:30']]) {
    const response = await post({ ...payload(), localDate, localTime }); assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().error.code, 'INVALID_LOCAL_TIME');
   }
  });
  await t.test('manual and actual customer HTTP booking compete for one shared resource', async () => {
   await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { requireVerifiedPhone: false } });
   for (let attempt = 0; attempt < 4; attempt++) {
    const localDate = `2027-03-${16 + attempt}`, startsAt = `${localDate}T14:00:00.000Z`;
    const [manual, consumer] = await Promise.all([post({ ...payload(), localDate }), app.inject({ method: 'POST', url: '/v1/bookings', headers, payload: { finalConsent: true, businessId: business.id, staffId: staff.id, serviceId: service.id, startsAt, idempotencyKey: randomUUID() } })]);
    assert.equal([manual, consumer].filter(response => response.statusCode === 200 || response.statusCode === 201).length, 1, `${manual.body} / ${consumer.body}`);
    assert.equal([manual, consumer].filter(response => response.statusCode === 409).length, 1, `${manual.body} / ${consumer.body}`);
    const rows = await prisma.booking.findMany({ where: { businessId: business.id, startsAt: new Date(startsAt) } });
    const diagnostic = JSON.stringify({ manual: { status: manual.statusCode, body: manual.body }, consumer: { status: consumer.statusCode, body: consumer.body }, rows: rows.map(row => ({ status: row.status, holdExpiresAt: row.holdExpiresAt })) });
    const occupied = rows.filter(row => row.status === 'CONFIRMED' || row.status === 'COMPLETED' || row.status === 'NO_SHOW' || (row.status === 'HELD' && row.holdExpiresAt !== null && row.holdExpiresAt > new Date()));
    assert.equal(occupied.length, 1, diagnostic);
    assert.equal(rows.filter(row => row.status === 'CONFIRMED').length, manual.statusCode === 200 ? 1 : 0, diagnostic);
    assert.ok(rows.every(row => occupied.includes(row) || row.status === 'EXPIRED'), diagnostic);
    for (const row of rows) if (row.status === 'HELD' && row.customerId) await releaseHold(row.id, row.customerId);
    await prisma.booking.deleteMany({ where: { businessId: business.id, startsAt: new Date(startsAt) } });
   }
  });
  await t.test('direct manual inserts cannot bypass actor/session audit guards', async () => {
   await assert.rejects(prisma.booking.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id, customerId: null, source: 'MANUAL', enteredByIdentityId: owner.id, customerName: 'Direct contact', customerPhone: '+12025550123', manualFingerprint: 'a'.repeat(64), startsAt: new Date('2027-03-20T14:00:00Z'), endsAt: new Date('2027-03-20T14:30:00Z'), occupiedFrom: new Date('2027-03-20T13:50:00Z'), occupiedUntil: new Date('2027-03-20T14:40:00Z'), status: 'CONFIRMED', idempotencyKey: randomUUID() } }));
  });
 } finally { await app.close(); await prisma.booking.deleteMany({ where: { businessId: business.id } }); await prisma.business.delete({ where: { id: business.id } }); await prisma.identity.deleteMany({ where: { id: { in: [owner.id, matchingIdentity.id] } } }); }
});

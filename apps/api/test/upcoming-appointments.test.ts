import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { tokenDigest } from '../src/security/sessions.js';
import { AppError } from '../src/http/errors.js';
import type { readUpcomingAppointment } from '../src/repositories/UpcomingAppointments.service.js';
import type { BookingStatus } from '../src/generated/prisma/client.js';

type UpcomingResult = Awaited<ReturnType<typeof readUpcomingAppointment>>;

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

test('Home upcoming appointments use owned future snapshots and consistent scoped counts', async t => {
  const run = randomUUID(), token = randomUUID();
  const owner = await prisma.identity.create({ data: { email: `upcoming-${run}@example.test` } });
  const other = await prisma.identity.create({ data: { email: `upcoming-other-${run}@example.test` } });
  const business = await prisma.business.create({ data: { name: 'Unpublished appointment provider', slug: `upcoming-${run}`, approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const second = await prisma.business.create({ data: { name: 'Other provider', slug: `upcoming-second-${run}`, approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Historical provider', parallelCapacity: 20 } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Original private appointment snapshot', durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } });
  const secondStaff = await prisma.staff.create({ data: { businessId: second.id, displayName: 'Second provider' } });
  const secondService = await prisma.service.create({ data: { businessId: second.id, name: 'Second service', durationMinutes: 30 } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.staffService.create({ data: { businessId: second.id, staffId: secondStaff.id, serviceId: secondService.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.bookingPolicy.create({ data: { businessId: second.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.membership.create({ data: { identityId: owner.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.session.create({ data: { identityId: owner.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: error instanceof AppError ? error.code : 'INVALID' }));
  await registerBookingRoutes(app);
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
  const url = '/v1/me/bookings/upcoming';
  const startsAt = new Date(Date.now() + 3 * 86400000);
  const create = (id: string, status: BookingStatus, offset = 0, customerId = owner.id, elsewhere = false) => {
    const start = new Date(+startsAt + offset), end = new Date(+start + 1800000);
    return prisma.booking.create({ data: { id: `${run}-${id}`, businessId: elsewhere ? second.id : business.id, staffId: elsewhere ? secondStaff.id : staff.id, serviceId: elsewhere ? secondService.id : service.id, customerId, status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 300000) : null, startsAt: start, endsAt: end, occupiedFrom: start, occupiedUntil: end, idempotencyKey: randomUUID(), serviceName: 'Original private appointment snapshot', serviceDurationMinutes: 30, servicePriceMinor: 12500, serviceCurrency: 'ILS' } });
  };
  try {
    await t.test('empty result is explicit and unauthenticated reads fail', async () => {
      assert.equal((await app.inject({ url })).statusCode, 401);
      const response = await app.inject({ url, headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { booking: null, additionalCount: 0 });
    });
    await create('z', 'CONFIRMED'); await create('a', 'CONFIRMED');
    await create('later', 'CONFIRMED', 86400000, owner.id, true);
    await create('foreign', 'CONFIRMED', -86400000, other.id);
    await create('past', 'CONFIRMED', -5 * 86400000);
    for (const status of ['HELD', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] satisfies BookingStatus[]) await create(status, status, -86400000);
    await prisma.service.update({ where: { id: service.id }, data: { name: 'Changed live service', durationMinutes: 90, active: false } });
    await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } });
    await t.test('ties sort by ID, status and time exclude inactive rows, and private projection stays minimal', async () => {
      const response = await app.inject({ url, headers });
      assert.equal(response.statusCode, 200, response.body);
      const result = response.json<UpcomingResult>();
      assert.ok(result.booking);
      assert.equal(result.booking.id, `${run}-a`); assert.equal(result.additionalCount, 2);
      assert.deepEqual(Object.keys(result.booking).sort(), ['actions', 'business', 'endsAt', 'id', 'revision', 'service', 'staff', 'startsAt', 'status'].sort());
      assert.deepEqual(result.booking.business, { id: business.id, name: business.name, timezone: 'Asia/Jerusalem' });
      assert.equal(result.booking.service.name, 'Original private appointment snapshot');
      assert.equal(result.booking.service.durationMinutes, 30);
      assert.deepEqual(result.booking.staff, { displayName: staff.displayName });
      assert.equal(response.body.includes(owner.email ?? 'missing-email'), false);
      assert.equal(response.body.includes(other.id), false);
      assert.equal(response.body.includes(staff.id), false);
      assert.equal(result.booking.actions.canCancel, true); assert.equal(result.booking.actions.canReschedule, true);
    });
    await t.test('context filters owned appointments without provider agenda expansion', async () => {
      const scoped = await app.inject({ url: `${url}?businessId=${business.id}`, headers });
      assert.equal(scoped.json<UpcomingResult>().booking?.id, `${run}-a`); assert.equal(scoped.json<UpcomingResult>().additionalCount, 1);
      const otherContext = await app.inject({ url: `${url}?businessId=${second.id}`, headers });
      assert.equal(otherContext.json<UpcomingResult>().booking?.id, `${run}-later`); assert.equal(otherContext.json<UpcomingResult>().additionalCount, 0);
      assert.deepEqual((await app.inject({ url: `${url}?businessId=unknown`, headers })).json(), { booking: null, additionalCount: 0 });
      for (const query of ['businessId=', 'identityId=forged', 'businessId=x&businessId=y']) assert.equal((await app.inject({ url: `${url}?${query}`, headers })).statusCode, 400);
    });
    await t.test('policy flags fail closed while removed providers retain owned read access', async () => {
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { cancellationCutoffMinutes: 10000, rescheduleCutoffMinutes: 10000 } });
      let result = (await app.inject({ url, headers })).json<UpcomingResult>();
      assert.ok(result.booking);
      assert.equal(result.booking.actions.canCancel, false); assert.equal(result.booking.actions.canReschedule, false);
      await prisma.bookingPolicy.delete({ where: { businessId: business.id } });
      await prisma.business.update({ where: { id: business.id }, data: { deletedAt: new Date() } });
      result = (await app.inject({ url, headers })).json<UpcomingResult>();
      assert.ok(result.booking);
      assert.equal(result.booking.id, `${run}-a`); assert.equal(result.additionalCount, 2);
      assert.equal(result.booking.actions.canCancel, false); assert.equal(result.booking.actions.canReschedule, false);
    });
    await t.test('committed cancellation advances the card and count together', async () => {
      await prisma.booking.update({ where: { id: `${run}-a` }, data: { status: 'CANCELLED' } });
      const result = (await app.inject({ url, headers })).json<UpcomingResult>();
      assert.equal(result.booking?.id, `${run}-z`); assert.equal(result.additionalCount, 1);
      await prisma.booking.update({ where: { id: `${run}-z` }, data: { status: 'CANCELLED' } });
      assert.deepEqual((await app.inject({ url: `${url}?businessId=${business.id}`, headers })).json(), { booking: null, additionalCount: 0 });
    });
    await t.test('revoked sessions cannot refresh private Home data', async () => {
      await prisma.session.updateMany({ where: { identityId: owner.id }, data: { revokedAt: new Date() } });
      assert.equal((await app.inject({ url, headers })).statusCode, 401);
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: { in: [business.id, second.id] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, second.id] } } });
    await prisma.identity.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
  }
});

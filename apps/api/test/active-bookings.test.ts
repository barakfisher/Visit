import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { tokenDigest } from '../src/security/sessions.js';
import { AppError, RESCHEDULE_CUTOFF } from '../src/http/errors.js';
import type { listActiveCustomerBookings } from '../src/repositories/bookings.js';

type ActiveBooking = Awaited<ReturnType<typeof listActiveCustomerBookings>>[number];
const MINUTE = 60000, CUTOFF_MINUTES = 24 * 60;

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

test('the Appointments list offers only the changes the server will accept, and reschedule names the original time', async t => {
  const run = randomUUID(), token = randomUUID();
  const customer = await prisma.identity.create({ data: { email: `active-${run}@example.test` } });
  const business = await prisma.business.create({ data: { name: 'Cutoff provider', slug: `active-${run}`, approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const unconfigured = await prisma.business.create({ data: { name: 'Removed policy provider', slug: `active-none-${run}`, approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Staff', parallelCapacity: 5 } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Service', durationMinutes: 30 } });
  const otherStaff = await prisma.staff.create({ data: { businessId: unconfigured.id, displayName: 'Other staff' } });
  const otherService = await prisma.service.create({ data: { businessId: unconfigured.id, name: 'Other service', durationMinutes: 30 } });
  for (const id of [business.id, unconfigured.id]) await prisma.bookingPolicy.create({ data: { businessId: id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: CUTOFF_MINUTES, rescheduleCutoffMinutes: CUTOFF_MINUTES } });
  await prisma.session.create({ data: { identityId: customer.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 10 * MINUTE) } });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INVALID' } }));
  await registerScreenFlows(app);
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
  const create = (id: string, startsInMinutes: number, elsewhere = false) => {
    const start = new Date(Date.now() + startsInMinutes * MINUTE), end = new Date(+start + 30 * MINUTE);
    return prisma.booking.create({ data: { id: `${run}-${id}`, businessId: elsewhere ? unconfigured.id : business.id, staffId: elsewhere ? otherStaff.id : staff.id, serviceId: elsewhere ? otherService.id : service.id, customerId: customer.id, status: 'CONFIRMED', startsAt: start, endsAt: end, occupiedFrom: start, occupiedUntil: end, idempotencyKey: randomUUID(), serviceName: 'Service', serviceDurationMinutes: 30 } });
  };
  try {
    const outside = await create('outside', CUTOFF_MINUTES + 120);
    await create('inside', CUTOFF_MINUTES - 120);
    await create('unconfigured', CUTOFF_MINUTES + 120, true);
    // A booking needs a policy to be confirmed; removing it afterwards leaves the appointment without one.
    await prisma.bookingPolicy.delete({ where: { businessId: unconfigured.id } });
    await t.test('each active appointment carries the customer actions of its business policy', async () => {
      const response = await app.inject({ url: '/api/consumer/bookings/active', headers });
      assert.equal(response.statusCode, 200, response.body);
      const bookings = new Map(response.json<{ bookings: ActiveBooking[] }>().bookings.map(booking => [booking.id, booking]));
      assert.deepEqual(bookings.get(`${run}-outside`)?.actions, { canExport: true, canCancel: true, canReschedule: true });
      assert.deepEqual(bookings.get(`${run}-inside`)?.actions, { canExport: true, canCancel: false, canReschedule: false });
      assert.deepEqual(bookings.get(`${run}-unconfigured`)?.actions, { canExport: true, canCancel: false, canReschedule: false });
      // The policy and approval state used for the decision stay on the server.
      assert.deepEqual(bookings.get(`${run}-outside`)?.business, { id: business.id, name: business.name, timezone: 'Asia/Jerusalem' });
    });
    await t.test('the reschedule screen reads the time being moved', async () => {
      const response = await app.inject({ url: `/api/bookings/${outside.id}/provider`, headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json<{ startsAt: string }>().startsAt, outside.startsAt.toISOString());
      const refused = await app.inject({ url: `/api/bookings/${run}-inside/provider`, headers });
      assert.equal(refused.statusCode, 409); assert.equal(refused.json<{ error: { code: string } }>().error.code, RESCHEDULE_CUTOFF);
    });
  } finally {
    await prisma.booking.deleteMany({ where: { customerId: customer.id } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, unconfigured.id] } } });
    await prisma.identity.delete({ where: { id: customer.id } });
    await app.close();
  }
});

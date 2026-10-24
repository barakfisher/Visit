import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify, { type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { registerFlowAuth } from '../src/routes/flow-auth.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { authenticate, tokenDigest } from '../src/security/sessions.js';
import { requireBusinessMembership, requirePublicBusiness, type AuthorizedBusinessContext, type PublicBusinessContext } from '../src/security/tenant-context.js';
import { createBusinessService, deleteBusinessService, getBusinessService, listBusinessServices, listPublicServices, updateBusinessService } from '../src/repositories/services.js';
import { listCustomerBookings } from '../src/repositories/bookings.js';
import { saveBusinessPolicy, getBusinessAvailability } from '../src/repositories/provider-settings.js';

const denied = (status: number) => (error: unknown) => error instanceof AppError && error.statusCode === status;
const foreignKey = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003';

test('tenant repositories and both HTTP surfaces enforce scope, ownership and current access', async t => {
  const run = randomUUID();
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'VALIDATION_ERROR' } }));
  await registerAuthRoutes(app); await registerProviderRoutes(app); await registerBookingRoutes(app); await registerFlowAuth(app); await registerScreenFlows(app);
  const businesses = await Promise.all(['a', 'b', 'hidden'].map(name => prisma.business.create({ data: { name: `${name}-${run}`, slug: `isolation-${name}-${run}`, timezone: 'UTC', approvalStatus: name === 'hidden' ? 'PENDING' : 'APPROVED' } })));
  const [a, b, hidden] = businesses;
  const people = await Promise.all(['a', 'b', 'dual', 'staff', 'pending', 'outsider'].map(name => prisma.identity.create({ data: { email: `isolation-${name}-${run}@example.test` } })));
  const [ownerA, ownerB, dual, staffMember, pending, outsider] = people;
  const tokens = people.map(() => randomUUID());
  const headers = (actor: number) => ({ authorization: `Bearer ${tokens[actor]}`, 'x-visit-client': 'native' });
  const base = (businessId: string) => `/v1/provider/businesses/${businessId}`;
  const policy = { minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 };
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const rules = { weekly: [{ weekday: 1, intervals: [{ startLocal: '09:00', endLocal: '17:00' }] }], overrides: [] };
  try {
    await prisma.session.createMany({ data: people.map((person, index) => ({ identityId: person.id, tokenHash: tokenDigest(tokens[index]!), expiresAt: new Date(Date.now() + 600000) })) });
    await prisma.membership.createMany({ data: [
      { identityId: ownerA!.id, businessId: a!.id, role: 'OWNER', status: 'ACTIVE' },
      { identityId: ownerB!.id, businessId: b!.id, role: 'OWNER', status: 'ACTIVE' },
      ...[a!, b!].map(business => ({ identityId: dual!.id, businessId: business.id, role: 'MANAGER' as const, status: 'ACTIVE' as const })),
      { identityId: staffMember!.id, businessId: a!.id, role: 'STAFF', status: 'ACTIVE' },
      { identityId: pending!.id, businessId: a!.id, role: 'OWNER', status: 'PENDING' },
    ] });
    const services = await Promise.all(businesses.map(business => prisma.service.create({ data: { businessId: business.id, name: 'Private service', durationMinutes: 30 } })));
    const [serviceA, serviceB] = services;
    const staff = await Promise.all([a!, b!].map(business => prisma.staff.create({ data: { businessId: business.id, displayName: 'Resource' } })));
    const [staffA, staffB] = staff;
    for (const [index, business] of [a!, b!].entries()) {
      await prisma.staffService.create({ data: { businessId: business.id, staffId: staff[index]!.id, serviceId: services[index]!.id } });
      await prisma.bookingPolicy.create({ data: { businessId: business.id, ...policy } });
      await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
    }
    const seedBooking = (index: number, customerId: string) => ({ businessId: businesses[index]!.id, staffId: staff[index]!.id, serviceId: services[index]!.id, customerId, startsAt: new Date(`${date}T09:00:00Z`), endsAt: new Date(`${date}T09:30:00Z`), occupiedFrom: new Date(`${date}T09:00:00Z`), occupiedUntil: new Date(`${date}T09:30:00Z`), idempotencyKey: randomUUID(), status: 'CONFIRMED' as const });
    const bookingA = await prisma.booking.create({ data: seedBooking(0, ownerA!.id) });
    const bookingB = await prisma.booking.create({ data: seedBooking(1, outsider!.id) });
    const blockB = await prisma.timeBlock.create({ data: { businessId: b!.id, staffId: staffB!.id, startsAt: new Date(`${date}T12:00:00Z`), endsAt: new Date(`${date}T12:30:00Z`) } });

    await t.test('repository CRUD rejects forged/cloned contexts, foreign IDs and tenant reassignment', async () => {
      const context = await requireBusinessMembership(ownerA!.id, a!.id);
      const created = await createBusinessService(context, { name: 'Owned CRUD', durationMinutes: 15 });
      assert.equal((await getBusinessService(context, created.id)).businessId, a!.id);
      assert.ok((await listBusinessServices(context)).some(row => row.id === created.id));
      assert.equal((await updateBusinessService(context, created.id, { name: 'Updated' })).name, 'Updated');
      await assert.rejects(getBusinessService(context, serviceB!.id), denied(404));
      await assert.rejects(updateBusinessService(context, serviceB!.id, { name: 'Foreign' }), denied(404));
      await assert.rejects(deleteBusinessService(context, serviceB!.id), denied(404));
      const clone = { ...context, businessId: b!.id } as AuthorizedBusinessContext;
      await assert.rejects(listBusinessServices(clone), denied(403));
      const malicious = { name: 'Reparent', businessId: b!.id };
      await assert.rejects(updateBusinessService(context, serviceA!.id, malicious), denied(400));
      await assert.rejects(createBusinessService(context, { ...malicious, durationMinutes: 15 }), denied(400));
      assert.equal((await prisma.service.findUniqueOrThrow({ where: { id: serviceA!.id } })).businessId, a!.id);
      assert.deepEqual(await deleteBusinessService(context, created.id), { deleted: true, archived: false });
      assert.equal(await prisma.service.count({ where: { id: created.id } }), 0);
      await assert.rejects(listPublicServices({ businessId: hidden!.id, timezone: 'UTC' } as PublicBusinessContext), denied(403));
      assert.equal((await listPublicServices(await requirePublicBusiness(a!.id)))[0]?.name, 'Private service');
      await assert.rejects(requirePublicBusiness(hidden!.id), denied(404));
      const staffContext = await requireBusinessMembership(staffMember!.id, a!.id);
      await assert.rejects(createBusinessService(staffContext, { name: 'Forbidden', durationMinutes: 15 }), denied(403));
    });

    await t.test('legacy and screen service routes reject foreign scope and preserve stored rows', async () => {
      assert.equal((await app.inject({ url: `${base(a!.id)}/services` })).statusCode, 401);
      for (const actor of [1, 4, 5]) {
        for (const [method, url, payload] of [
          ['GET', `${base(a!.id)}/services`, undefined],
          ['POST', `${base(a!.id)}/services`, { name: 'Forbidden', durationMinutes: 15 }],
          ['PATCH', `${base(a!.id)}/services/${serviceA!.id}`, { name: 'Forbidden' }],
          ['DELETE', `${base(a!.id)}/services/${serviceA!.id}`, undefined],
          ['GET', `/api/provider/services?businessId=${a!.id}`, undefined],
        ] as const) {
          const result = await app.inject({ method, url, headers: headers(actor), ...(payload ? { payload } : {}) });
          assert.equal(result.statusCode, 403, `${method} ${url}`);
        }
      }
      for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
        assert.equal((await app.inject({ method, url: `${base(a!.id)}/services/${serviceB!.id}`, headers: headers(0), ...(method === 'PATCH' ? { payload: { name: 'Forbidden' } } : {}) })).statusCode, 404);
      }
      assert.equal((await prisma.service.findUniqueOrThrow({ where: { id: serviceB!.id } })).name, 'Private service');
      // Body/header tenant selectors never override the authorized URL context.
      const created = await app.inject({ method: 'POST', url: `${base(a!.id)}/services`, headers: { ...headers(0), 'x-business-id': b!.id }, payload: { businessId: b!.id, name: 'Scoped create', durationMinutes: 15 } });
      assert.equal(created.statusCode, 400); // Unknown scope fields are now rejected by the shared contract.
      const headerOnly = await app.inject({ method: 'POST', url: `${base(a!.id)}/services`, headers: { ...headers(0), 'x-business-id': b!.id }, payload: { name: 'Scoped create', durationMinutes: 15 } });
      assert.equal(headerOnly.statusCode, 201); assert.equal(headerOnly.json().businessId, a!.id);
      assert.equal((await app.inject({ method: 'POST', url: `/api/provider/services?businessId=${a!.id}`, headers: headers(0), payload: { name: 'Foreign staff', durationMinutes: 15, staffIds: [staffB!.id] } })).statusCode, 404);
      assert.equal(await prisma.service.count({ where: { businessId: a!.id, name: 'Foreign staff' } }), 0);
    });

    await t.test('staff, policy and availability enforce tenant context; valid multi-business access works', async () => {
      const before = await prisma.bookingPolicy.findUniqueOrThrow({ where: { businessId: b!.id } });
      for (const suffix of ['staff', 'booking-policy', 'availability-rules']) {
        assert.equal((await app.inject({ url: `${base(b!.id)}/${suffix}`, headers: headers(0) })).statusCode, 403);
      }
      assert.equal((await app.inject({ method: 'PUT', url: `${base(b!.id)}/booking-policy`, headers: headers(0), payload: { ...policy, maximumAdvanceDays: 99 } })).statusCode, 403);
      assert.deepEqual(await prisma.bookingPolicy.findUniqueOrThrow({ where: { businessId: b!.id } }), before);
      assert.equal((await app.inject({ method: 'POST', url: `${base(a!.id)}/staff`, headers: headers(0), payload: { displayName: 'Foreign assignment', serviceIds: [serviceB!.id] } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'PUT', url: `${base(a!.id)}/staff/${staffB!.id}/availability-rules`, headers: headers(0), payload: rules })).statusCode, 404);
      assert.equal((await app.inject({ method: 'PUT', url: `/api/provider/working-hours?businessId=${b!.id}`, headers: headers(0), payload: rules })).statusCode, 403);
      const context = await requireBusinessMembership(ownerA!.id, a!.id);
      await assert.rejects(saveBusinessPolicy(context, { ...policy, maximumAdvanceDays: 45, businessId: b!.id } as typeof policy), (error: unknown) => error instanceof AppError && error.statusCode === 400);
      await saveBusinessPolicy(context, { ...policy, maximumAdvanceDays: 45 });
      assert.equal((await prisma.bookingPolicy.findUniqueOrThrow({ where: { businessId: a!.id } })).maximumAdvanceDays, 45);
      assert.equal((await prisma.bookingPolicy.findUniqueOrThrow({ where: { businessId: b!.id } })).maximumAdvanceDays, 30);
      assert.equal((await getBusinessAvailability(context)).weekly.length, 7);
      for (const business of [a!, b!]) {
        assert.equal((await app.inject({ url: `${base(business.id)}/services`, headers: headers(2) })).statusCode, 200);
        assert.equal((await app.inject({ url: `/api/provider/agenda?businessId=${business.id}&date=${date}`, headers: headers(2) })).statusCode, 200);
      }
      assert.equal((await app.inject({ url: '/api/provider/services', headers: headers(2) })).statusCode, 400);
      assert.equal((await app.inject({ method: 'PUT', url: `${base(a!.id)}/booking-policy`, headers: headers(3), payload: policy })).statusCode, 403);
    });

    await t.test('private bookings use customer ownership or provider membership, never substituted IDs', async () => {
      const own = await app.inject({ url: `/v1/me/bookings?identityId=${outsider!.id}`, headers: headers(0) });
      assert.deepEqual(own.json().bookings.map((row: { id: string }) => row.id), [bookingA.id]);
      const customer = await app.inject({ url: '/api/consumer/bookings/active', headers: headers(5) });
      assert.deepEqual(customer.json().bookings.map((row: { id: string }) => row.id), [bookingB.id]);
      assert.equal((await app.inject({ url: `${base(b!.id)}/bookings`, headers: headers(0) })).statusCode, 403);
      assert.equal((await app.inject({ url: `/api/provider/agenda?businessId=${b!.id}&date=${date}`, headers: headers(0) })).statusCode, 403);
      for (const action of ['confirm', 'cancel', 'reschedule']) {
        assert.equal((await app.inject({ method: 'POST', url: `/v1/bookings/${bookingB.id}/${action}`, headers: headers(0), payload: action === 'reschedule' ? { staffId: staffB!.id, startsAt: `${date}T14:00:00Z` } : {} })).statusCode, 404);
      }
      assert.equal((await app.inject({ method: 'POST', url: `${base(a!.id)}/bookings/${bookingB.id}/cancel`, headers: headers(0) })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: '/api/bookings/confirm', headers: headers(0), payload: { holdId: bookingB.id } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/provider/block-time/${blockB.id}?businessId=${a!.id}`, headers: headers(0) })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: '/api/provider/block-time', headers: headers(0), payload: { businessId: a!.id, staffId: staffB!.id, date, startLocal: '14:00', endLocal: '14:30' } })).statusCode, 404);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: bookingB.id } })).status, 'CONFIRMED');
      assert.equal(await prisma.timeBlock.count({ where: { id: blockB.id } }), 1);
      const me = await app.inject({ url: `/v1/me?identityId=${ownerB!.id}`, headers: headers(0) });
      assert.equal(me.json().identity.id, ownerA!.id);
      assert.equal(me.json().memberships.length, 1);
      assert.equal((await app.inject({ url: '/v1/admin/provider-applications', headers: headers(0) })).statusCode, 403);
    });

    await t.test('database constraints reject foreign tenant references without repository validation', async () => {
      const before = await prisma.booking.count({ where: { businessId: { in: [a!.id, b!.id] } } });
      await assert.rejects(prisma.staffService.create({ data: { businessId: a!.id, staffId: staffA!.id, serviceId: serviceB!.id } }), foreignKey);
      await assert.rejects(prisma.staffService.create({ data: { businessId: a!.id, staffId: staffB!.id, serviceId: serviceA!.id } }), foreignKey);
      await assert.rejects(prisma.staffWeeklyAvailability.create({ data: { businessId: a!.id, staffId: staffB!.id, weekday: 1, startLocal: '09:00', endLocal: '10:00' } }), foreignKey);
      await assert.rejects(prisma.staffScheduleOverride.create({ data: { businessId: a!.id, staffId: staffB!.id, date: new Date(`${date}T00:00:00Z`), isOpen: false } }), foreignKey);
      await assert.rejects(prisma.timeBlock.create({ data: { businessId: a!.id, staffId: staffB!.id, startsAt: bookingA.startsAt, endsAt: bookingA.endsAt } }), foreignKey);
      await assert.rejects(prisma.booking.create({ data: { ...seedBooking(0, ownerA!.id), staffId: staffB!.id, startsAt: new Date(`${date}T15:00:00Z`), endsAt: new Date(`${date}T15:30:00Z`), occupiedFrom: new Date(`${date}T15:00:00Z`), occupiedUntil: new Date(`${date}T15:30:00Z`) } }), foreignKey);
      await assert.rejects(prisma.booking.create({ data: { ...seedBooking(0, ownerA!.id), serviceId: serviceB!.id, startsAt: new Date(`${date}T15:00:00Z`), endsAt: new Date(`${date}T15:30:00Z`), occupiedFrom: new Date(`${date}T15:00:00Z`), occupiedUntil: new Date(`${date}T15:30:00Z`) } }), foreignKey);
      assert.equal(await prisma.booking.count({ where: { businessId: { in: [a!.id, b!.id] } } }), before);
    });

    await t.test('all booking history is archived rather than deleted across scoped service CRUD', async () => {
      await prisma.booking.update({ where: { id: bookingA.id }, data: { status: 'CANCELLED' } });
      const result = await app.inject({ method: 'DELETE', url: `${base(a!.id)}/services/${serviceA!.id}`, headers: headers(0) });
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().archived, true);
      assert.equal(await prisma.booking.count({ where: { id: bookingA.id } }), 1);
      assert.equal((await prisma.service.findUniqueOrThrow({ where: { id: serviceB!.id } })).active, true);
    });

    await t.test('revoked membership, withdrawn approval and revoked sessions invalidate issued contexts', async () => {
      const context = await requireBusinessMembership(ownerA!.id, a!.id);
      const publicContext = await requirePublicBusiness(a!.id);
      const membershipKey = { identityId: ownerA!.id, businessId: a!.id, role: 'OWNER' as const };
      await prisma.membership.update({ where: { identityId_businessId_role: membershipKey }, data: { status: 'REVOKED' } });
      await assert.rejects(listBusinessServices(context), denied(403));
      assert.equal((await app.inject({ url: `${base(a!.id)}/services`, headers: headers(0) })).statusCode, 403);
      assert.equal((await app.inject({ url: `/api/provider/agenda?businessId=${a!.id}&date=${date}`, headers: headers(0) })).statusCode, 403);
      await prisma.membership.update({ where: { identityId_businessId_role: membershipKey }, data: { status: 'ACTIVE' } });
      await prisma.business.update({ where: { id: a!.id }, data: { approvalStatus: 'REJECTED' } });
      await assert.rejects(listBusinessServices(context), denied(403));
      await assert.rejects(listPublicServices(publicContext), denied(404));
      assert.equal((await app.inject({ url: `${base(a!.id)}/bookings`, headers: headers(0) })).statusCode, 403);
      await prisma.business.update({ where: { id: a!.id }, data: { approvalStatus: 'APPROVED' } });
      const session = await authenticate({ headers: headers(5) } as unknown as FastifyRequest);
      await assert.rejects(listCustomerBookings({ ...session, identity: { ...session.identity, id: ownerA!.id } }), denied(401));
      await prisma.session.update({ where: { id: session.sessionId }, data: { revokedAt: new Date() } });
      await assert.rejects(listCustomerBookings(session), denied(401));
      assert.equal((await app.inject({ url: '/api/consumer/bookings/active', headers: headers(5) })).statusCode, 401);
    });
  } finally {
    await app.close();
    const ids = businesses.map(business => business.id);
    await prisma.booking.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    await prisma.identity.deleteMany({ where: { id: { in: people.map(person => person.id) } } });
    // No positive Redis operation is needed here; QUIT on a lazy client can
    // start a connection during teardown and leave the test worker alive.
    redis.disconnect();
    await prisma.$disconnect();
  }
});

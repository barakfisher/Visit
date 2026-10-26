import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { registerAccountMethods } from '../src/routes/account-methods.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { tokenDigest } from '../src/security/sessions.js';
import { customerContactReadiness } from '../src/security/customer-contact.utils.js';
import { withBookingTransaction } from '../src/scheduling/booking-transaction.js';
import { saveBusinessPolicy } from '../src/repositories/provider-settings.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { DEFAULT_BOOKING_POLICY } from '../src/scheduling/rules.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });

test('contact requirements depend on verified evidence rather than sign-in or client assertions', () => {
  const person = { displayName: null, phone: '+972501234567', phoneVerifiedAt: null, email: 'a@example.test', emailVerifiedAt: new Date() };
  assert.deepEqual(customerContactReadiness({ requireCustomerName: true, requireVerifiedPhone: true, requireVerifiedEmail: true }, person).missing, ['name', 'phone']);
  assert.equal(customerContactReadiness({ requireCustomerName: false, requireVerifiedPhone: false, requireVerifiedEmail: true }, person).ready, true);
});

test('tenant contact policy guards HTTP holds, direct confirmations, snapshots and policy changes', async t => {
  const suffix = randomUUID(), token = randomUUID();
  const person = await prisma.identity.create({ data: { email: `contact-${suffix}@example.test` } });
  const other = await prisma.identity.create({ data: { email: `other-${suffix}@example.test` } });
  const businesses: string[] = [];
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: error instanceof AppError ? error.code : 'INVALID' }));
  await registerAccountMethods(app); await registerBookingRoutes(app);
  const headers = { authorization: `Bearer ${token}` };
  await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  async function fixture(requirements: { requireVerifiedPhone?: boolean; requireVerifiedEmail?: boolean; requireCustomerName?: boolean }) {
    const b = await prisma.business.create({ data: { name: 'Contact fixture', slug: `contact-${randomUUID()}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businesses.push(b.id);
    await prisma.bookingPolicy.create({ data: { ...DEFAULT_BOOKING_POLICY, businessId: b.id, ...requirements } });
    const service = await prisma.service.create({ data: { businessId: b.id, name: 'Visit', durationMinutes: 30 } });
    const staff = await prisma.staff.create({ data: { businessId: b.id, displayName: 'Fixture' } });
    await prisma.staffService.create({ data: { businessId: b.id, staffId: staff.id, serviceId: service.id } });
    let index = 0;
    const input = () => { const startsAt = new Date(Date.now() + (10 + index++) * 86400000), endsAt = new Date(startsAt.getTime() + 1800000); return { businessId: b.id, customerId: person.id, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: randomUUID(), status: 'CONFIRMED' as const }; };
    return { b, input };
  }
  try {
    const phone = await fixture({ requireVerifiedPhone: true }), email = await fixture({ requireVerifiedEmail: true }), combined = await fixture({ requireVerifiedPhone: true, requireVerifiedEmail: true, requireCustomerName: true });
    const rejected = (operation: () => Promise<unknown>) => assert.rejects(withBookingTransaction(() => operation()), (error: unknown) => error instanceof AppError && error.code === 'CUSTOMER_CONTACT_REQUIRED');
    await t.test('own-only readiness exposes requirements without publishing private profile', async () => {
      assert.equal((await app.inject({ url: `/api/providers/${phone.b.id}/contact-readiness` })).statusCode, 401);
      const result = await app.inject({ url: `/api/providers/${phone.b.id}/contact-readiness`, headers });
      assert.deepEqual(result.json().missing, ['phone']); assert.equal(result.json().profile.email, person.email);
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/account/profile', headers, payload: { displayName: 'Other', identityId: other.id, phoneVerifiedAt: new Date() } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/account/profile', headers, payload: { displayName: 'Customer' } })).statusCode, 200);
      assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: other.id } })).displayName, null);
    });
    await t.test('unverified values and forged snapshot fields cannot create confirmed or held rows', async () => {
      await prisma.identity.update({ where: { id: person.id }, data: { phone: '+972599123456' } });
      for (const f of [phone, email, combined]) await rejected(() => prisma.booking.create({ data: { ...f.input(), customerPhone: '+972599123456', customerPhoneVerifiedAt: new Date(), customerEmail: person.email, customerEmailVerifiedAt: new Date(), customerContactCapturedAt: new Date() } }));
      await rejected(() => prisma.booking.create({ data: { ...phone.input(), status: 'HELD', holdExpiresAt: new Date(Date.now() + 60000) } }));
      const input = phone.input(); input.startsAt.setUTCSeconds(0, 0);
      const result = await app.inject({ method: 'POST', url: '/v1/bookings', headers, payload: { businessId: phone.b.id, serviceId: input.serviceId, staffId: input.staffId, startsAt: input.startsAt.toISOString(), idempotencyKey: randomUUID(), verified: true } });
      assert.equal(result.statusCode, 409); assert.equal(result.json().error, 'CUSTOMER_CONTACT_REQUIRED');
      assert.equal(await prisma.booking.count({ where: { customerId: person.id } }), 0);
    });
    await t.test('phone-only, email-only and combined businesses use independent current requirements', async () => {
      await prisma.identity.update({ where: { id: person.id }, data: { phoneVerifiedAt: new Date() } });
      await prisma.booking.create({ data: phone.input() }); await rejected(() => prisma.booking.create({ data: email.input() }));
      await prisma.identity.update({ where: { id: person.id }, data: { phoneVerifiedAt: null, emailVerifiedAt: new Date() } });
      await prisma.booking.create({ data: email.input() }); await rejected(() => prisma.booking.create({ data: phone.input() })); await rejected(() => prisma.booking.create({ data: combined.input() }));
      await prisma.identity.update({ where: { id: person.id }, data: { phoneVerifiedAt: new Date() } });
      const booked = await prisma.booking.create({ data: combined.input() });
      assert.equal(booked.customerName, 'Customer'); assert.equal(booked.customerPhone, '+972599123456'); assert.equal(booked.customerEmail, person.email); assert.ok(booked.customerContactCapturedAt);
      await prisma.identity.update({ where: { id: person.id }, data: { displayName: 'Changed', phone: null, phoneVerifiedAt: null, emailVerifiedAt: null } });
      assert.deepEqual(await prisma.booking.findUnique({ where: { id: booked.id } }), booked);
      await assert.rejects(prisma.booking.update({ where: { id: booked.id }, data: { customerName: 'Forged' } }));
      await assert.rejects(prisma.booking.update({ where: { id: booked.id }, data: { customerId: other.id } }));
      await prisma.booking.update({ where: { id: booked.id }, data: { status: 'CANCELLED' } });
    });
    await t.test('confirmation racing a committed stricter policy cannot use stale contact readiness', async () => {
      const f = await fixture({});
      const held = await prisma.booking.create({ data: { ...f.input(), status: 'HELD', holdExpiresAt: new Date(Date.now() + 60000) } });
      let locked!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { locked = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      const tightening = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${f.b.id} FOR UPDATE`;
        await tx.bookingPolicy.update({ where: { businessId: f.b.id }, data: { requireVerifiedPhone: true } });
        locked(); await wait;
      });
      await ready;
      const confirming = withBookingTransaction(tx => tx.booking.update({ where: { id: held.id }, data: { status: 'CONFIRMED', holdExpiresAt: null } }));
      const outcome = confirming.then(() => null, error => error);
      release(); await tightening;
      const error = await outcome;
      assert.ok(error instanceof AppError && error.code === 'CUSTOMER_CONTACT_REQUIRED');
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: held.id } })).status, 'HELD');
    });
    await t.test('policy tightening expires holds and old-client omissions preserve stricter rules', async () => {
      const f = await fixture({});
      await prisma.membership.create({ data: { businessId: f.b.id, identityId: person.id, role: 'OWNER', status: 'ACTIVE' } });
      const context = await requireBusinessMembership(person.id, f.b.id, ['OWNER']);
      const held = await prisma.booking.create({ data: { ...f.input(), status: 'HELD', holdExpiresAt: new Date(Date.now() + 60000) } });
      await saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, requireVerifiedPhone: true });
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: held.id } })).status, 'EXPIRED');
      assert.equal((await saveBusinessPolicy(context, DEFAULT_BOOKING_POLICY)).requireVerifiedPhone, true);
      await rejected(() => prisma.booking.create({ data: f.input() }));
    });
  } finally {
    await app.close(); await prisma.booking.deleteMany({ where: { businessId: { in: businesses } } }); await prisma.business.deleteMany({ where: { id: { in: businesses } } }); await prisma.identity.deleteMany({ where: { id: { in: [person.id, other.id] } } });
  }
});

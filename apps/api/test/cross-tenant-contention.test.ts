import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { tokenDigest } from '../src/security/sessions.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { BOOKING_ISOLATION_LEVEL, withBookingTransaction } from '../src/scheduling/booking-transaction.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

// Unrelated businesses share no rows, but their bookings share index and heap pages. Under SERIALIZABLE those
// pages carried predicate locks, and concurrent moves in different businesses refused each other with
// "Availability changed" (decisions.md, "Booking transactions run at Repeatable Read").
const TENANTS = 6;
const ROUNDS = 3;

async function tenant(day: string) {
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { publishedAt: new Date(), location: 'Synthetic fixture', name: 'Contention fixture', slug: `contention-${suffix}`, timezone: 'UTC', approvalStatus: 'APPROVED' } });
  const identity = await prisma.identity.create({ data: { email: `contention-${suffix}@example.test` } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Contention service', durationMinutes: 30 } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Contention staff', parallelCapacity: 1 } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
  const token = randomUUID();
  await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  const startsAt = new Date(`${day}T09:00:00Z`);
  const booking = await prisma.booking.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id, customerId: identity.id, startsAt, endsAt: new Date(+startsAt + 1800000), occupiedFrom: startsAt, occupiedUntil: new Date(+startsAt + 1800000), status: 'CONFIRMED', idempotencyKey: randomUUID() } });
  return { business, identity, staff, booking, token };
}

test('booking transactions run at the booking isolation level', async () => {
  const rows = await withBookingTransaction(tx => tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`);
  assert.equal(rows[0]?.transaction_isolation, { RepeatableRead: 'repeatable read', Serializable: 'serializable' }[BOOKING_ISOLATION_LEVEL]);
});

test('concurrent reschedules in unrelated businesses never refuse each other', async () => {
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const tenants = await Promise.all(Array.from({ length: TENANTS }, () => tenant(day)));
  const app = Fastify();
  await registerBookingRoutes(app, { acquireLocks: async () => ({ acquired: true, release: async () => true }) });
  try {
    for (let round = 0; round < ROUNDS; round++) {
      // Each round moves every booking one hour later, from the revision the previous round left.
      const startsAt = `${day}T${String(10 + round).padStart(2, '0')}:00:00Z`;
      const responses = await Promise.all(tenants.map(({ booking, staff, token }) => app.inject({ method: 'POST', url: `/v1/bookings/${booking.id}/reschedule`, headers: { authorization: `Bearer ${token}` }, payload: { finalConsent: true, expectedRevision: round, idempotencyKey: randomUUID(), staffId: staff.id, startsAt } })));
      for (const response of responses) assert.equal(response.statusCode, 200, response.body);
      for (const { booking } of tenants) assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).startsAt.toISOString(), new Date(startsAt).toISOString());
    }
  } finally {
    await app.close();
    for (const { business, identity } of tenants) {
      await prisma.booking.deleteMany({ where: { businessId: business.id } });
      await prisma.business.delete({ where: { id: business.id } });
      await prisma.identity.delete({ where: { id: identity.id } });
    }
  }
});

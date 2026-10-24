import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import test, { after } from 'node:test';
import { prisma } from '../src/db/client.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { tokenDigest } from '../src/security/sessions.js';
import { redis } from '../src/infra/redis.js';

after(async () => { await Promise.allSettled([redis.quit(), prisma.$disconnect()]); });

test('two overlapping booking requests cannot consume capacity one twice', async () => {
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: `Concurrent ${suffix}`, slug: `concurrent-${suffix}`, timezone: 'UTC', approvalStatus: 'APPROVED' } });
  const customerA = await prisma.identity.create({ data: { email: `customer-a-${suffix}@example.test`, emailVerifiedAt: new Date() } });
  const customerB = await prisma.identity.create({ data: { email: `customer-b-${suffix}@example.test`, emailVerifiedAt: new Date() } });
  const tokens = [randomUUID(), randomUUID()];
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Consultation', durationMinutes: 30 } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Alex', parallelCapacity: 1 } });
  const nowLocal = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const weekday = new Date(`${nowLocal}T12:00:00.000Z`).getUTCDay();
  await Promise.all([
    prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } }),
    prisma.businessWeeklyAvailability.create({ data: { businessId: business.id, weekday, startLocal: '09:00', endLocal: '12:00' } }),
    prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } }),
    prisma.session.create({ data: { identityId: customerA.id, tokenHash: tokenDigest(tokens[0]!), expiresAt: new Date(Date.now() + 60_000) } }),
    prisma.session.create({ data: { identityId: customerB.id, tokenHash: tokenDigest(tokens[1]!), expiresAt: new Date(Date.now() + 60_000) } }),
  ]);
  const app = Fastify();
  await registerBookingRoutes(app);
  await app.ready();
  const date = nowLocal;
  const startA = new Date(`${date}T10:00:00.000Z`).toISOString();
  const startB = new Date(`${date}T10:15:00.000Z`).toISOString();
  const post = (token: string, startsAt: string, key: string) => app.inject({ method: 'POST', url: '/v1/bookings', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: { businessId: business.id, serviceId: service.id, staffId: staff.id, startsAt, idempotencyKey: key } });
  try {
    const responses = await Promise.all([post(tokens[0]!, startA, `booking-${suffix}-a`), post(tokens[1]!, startB, `booking-${suffix}-b`)]);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 409]);
    const persisted = await prisma.booking.findMany({ where: { businessId: business.id } });
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.status, 'HELD');
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.session.deleteMany({ where: { identityId: { in: [customerA.id, customerB.id] } } });
    await prisma.identity.deleteMany({ where: { id: { in: [customerA.id, customerB.id] } } });
    await prisma.business.delete({ where: { id: business.id } });
  }
});

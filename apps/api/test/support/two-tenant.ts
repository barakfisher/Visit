import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/db/client.js';
import { env } from '../../src/env.js';
import { tokenDigest } from '../../src/security/sessions.js';

export const actors = ['north', 'south', 'dual', 'staff', 'pending', 'outsider'] as const;
function identifiers(run: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(run)) throw new Error('Fixture run must be a UUID.');
  const target = new URL(env.DATABASE_URL);
  if (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(target.hostname)) throw new Error('Fixtures require non-production loopback or disposable Compose PostgreSQL.');
  return { businessIds: ['north', 'south'].map(name => `qa-${run}-business-${name}`), identityIds: actors.map(name => `qa-${run}-identity-${name}`) };
}
export async function resetTwoTenantFixture(run: string) {
  const ids = identifiers(run);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`qa-fixture:${run}`}, 0))::text`;
    const businesses = await tx.business.findMany({ where: { id: { in: ids.businessIds } }, select: { id: true, slug: true } });
    const people = await tx.identity.findMany({ where: { id: { in: ids.identityIds } }, select: { id: true, email: true } });
    for (const business of businesses) if (!['north', 'south'].some(name => business.id === `qa-${run}-business-${name}` && business.slug === `qa-${run}-${name}`)) throw new Error('Refusing to remove a row without the exact fixture marker.');
    for (const person of people) if (!actors.some(name => person.id === `qa-${run}-identity-${name}` && person.email === `qa-${run}-${name}@example.test`)) throw new Error('Refusing to remove an identity without the exact fixture marker.');
    // Exact owned IDs only. Never truncate tables or flush Redis.
    await tx.booking.deleteMany({ where: { businessId: { in: businesses.map(row => row.id) } } });
    await tx.business.deleteMany({ where: { id: { in: businesses.map(row => row.id) } } });
    await tx.identity.deleteMany({ where: { id: { in: people.map(row => row.id) } } });
  });
}
export async function createTwoTenantFixture(run: string = randomUUID(), date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)) {
  const ids = identifiers(run);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Fixture date must be an ISO calendar date.');
  const tokens = actors.map(() => randomUUID());
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`qa-fixture:${run}`}, 0))::text`;
    if (await tx.business.count({ where: { id: { in: ids.businessIds } } }) || await tx.identity.count({ where: { id: { in: ids.identityIds } } })) throw new Error('Fixture already exists. Reset this exact run explicitly before creating it again.');
    const businesses = await Promise.all(['north', 'south'].map((name, index) => tx.business.create({ data: { id: ids.businessIds[index]!, name: `QA ${name}`, slug: `qa-${run}-${name}`, timezone: 'UTC', approvalStatus: 'APPROVED' } })));
    const people = await Promise.all(actors.map((name, index) => tx.identity.create({ data: { id: ids.identityIds[index]!, email: `qa-${run}-${name}@example.test`, emailVerifiedAt: new Date(), platformRole: 'USER' } })));
    await tx.session.createMany({ data: people.map((person, index) => ({ identityId: person.id, tokenHash: tokenDigest(tokens[index]!), expiresAt: new Date(Date.now() + 3600000) })) });
    await tx.membership.createMany({ data: [
      { identityId: people[0]!.id, businessId: businesses[0]!.id, role: 'OWNER', status: 'ACTIVE' },
      { identityId: people[1]!.id, businessId: businesses[1]!.id, role: 'OWNER', status: 'ACTIVE' },
      ...businesses.map(business => ({ identityId: people[2]!.id, businessId: business.id, role: 'MANAGER' as const, status: 'ACTIVE' as const })),
      { identityId: people[3]!.id, businessId: businesses[0]!.id, role: 'STAFF', status: 'ACTIVE' },
      { identityId: people[4]!.id, businessId: businesses[0]!.id, role: 'OWNER', status: 'PENDING' },
    ] });
    const services = [], staff = [], bookings = [], blocks = [];
    for (const [index, business] of businesses.entries()) {
      const service = await tx.service.create({ data: { id: `qa-${run}-service-${index}`, businessId: business.id, name: `QA service ${index}`, durationMinutes: 30, priceMinor: 5000, currency: 'ILS' } });
      const resource = await tx.staff.create({ data: { id: `qa-${run}-staff-${index}`, businessId: business.id, displayName: `QA staff ${index}`, parallelCapacity: 1 } });
      services.push(service); staff.push(resource);
      await tx.staffService.create({ data: { businessId: business.id, serviceId: service.id, staffId: resource.id } });
      await tx.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
      await tx.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
      await tx.staffWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, staffId: resource.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
      bookings.push(await tx.booking.create({ data: { id: `qa-${run}-booking-${index}`, businessId: business.id, customerId: people[index]!.id, serviceId: service.id, staffId: resource.id, idempotencyKey: `qa-${run}-booking-${index}`, startsAt: new Date(`${date}T09:00:00Z`), endsAt: new Date(`${date}T09:30:00Z`), occupiedFrom: new Date(`${date}T09:00:00Z`), occupiedUntil: new Date(`${date}T09:30:00Z`), status: 'CONFIRMED' } }));
      blocks.push(await tx.timeBlock.create({ data: { businessId: business.id, staffId: resource.id, startsAt: new Date(`${date}T12:00:00Z`), endsAt: new Date(`${date}T12:30:00Z`), reason: 'Synthetic fixture break' } }));
    }
    return { businesses, people, services, staff, bookings, blocks };
  });
  return { ...result, run, date, headers: (actor: typeof actors[number]) => ({ authorization: `Bearer ${tokens[actors.indexOf(actor)]!}`, 'x-visit-client': 'native' }), reset: () => resetTwoTenantFixture(run) };
}

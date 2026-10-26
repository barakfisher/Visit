import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { registerBookingRoutes } from '../src/routes/bookings.js';
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { getBusinessAvailability, getBusinessBookingCalendar } from '../src/repositories/availability.js';
import { requirePublicBusiness } from '../src/security/tenant-context.js';
import { tokenDigest } from '../src/security/sessions.js';
import { AppError } from '../src/http/errors.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });
test('bounded calendar derives selectable dates from the scoped authoritative slot engine', async t => {
  const run = randomUUID(), token = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Calendar', slug: `calendar-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const hidden = await prisma.business.create({ data: { name: 'Private calendar', slug: `calendar-private-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'PENDING' } });
  const person = await prisma.identity.create({ data: { email: `calendar-${run}@example.test` } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Calendar visit', durationMinutes: 30 } });
  const foreign = await prisma.service.create({ data: { businessId: hidden.id, name: 'Private service', durationMinutes: 30 } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Calendar provider' } });
  await prisma.staffService.create({ data: { businessId: business.id, serviceId: service.id, staffId: staff.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
  await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const day = (offset: number) => new Date(new Date(`${start}T12:00Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: error instanceof AppError ? error.code : 'INVALID' }));
  await registerBookingRoutes(app); await registerScreenFlows(app);
  const path = (serviceId = service.id, businessId = business.id, count = '3') => `/api/providers/${businessId}/booking-calendar?serviceId=${serviceId}&fromDate=${start}&days=${count}`;
  try {
    await t.test('calendar is advisory, bounded, strict and does not disclose private allocation data', async () => {
      const result = await app.inject({ url: path() }); assert.equal(result.statusCode, 200, result.body);
      assert.deepEqual(result.json().days, [0, 1, 2].map(offset => ({ date: day(offset), available: true })));
      assert.equal(result.json().timezone, 'Asia/Jerusalem'); assert.equal(result.json().advisory, true);
      assert.equal(result.body.includes(person.id), false); assert.equal(result.body.includes(staff.id), false);
      for (const count of ['0', '32', '-1', '1.5', 'bad']) assert.equal((await app.inject({ url: path(service.id, business.id, count) })).statusCode, 400);
      assert.equal((await app.inject({ url: path() + '&identityId=forged' })).statusCode, 400);
      assert.equal((await app.inject({ url: path(foreign.id) })).statusCode, 404);
      assert.equal((await app.inject({ url: path(foreign.id, hidden.id) })).statusCode, 404);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 0);
    });
    await t.test('closed overrides, notice, horizon, staff capacity and blocks agree with daily candidates', async () => {
      await prisma.scheduleOverride.create({ data: { businessId: business.id, date: new Date(`${day(1)}T00:00Z`), isOpen: false } });
      const block = await prisma.timeBlock.create({ data: { businessId: business.id, staffId: staff.id, startsAt: new Date(`${day(2)}T00:00Z`), endsAt: new Date(`${day(3)}T00:00Z`) } });
      const context = await requirePublicBusiness(business.id);
      const controlledNow = new Date(`${start}T14:45Z`); // 16:45 or17:45 Israeli local time, no fitting same-day start.
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { minimumNoticeMinutes: 60 } });
      const calendar = await getBusinessBookingCalendar(context, service.id, start, 4, controlledNow);
      for (const row of calendar.days) {
        const availability = await getBusinessAvailability(context, service.id, row.date, false, controlledNow);
        assert.equal(row.available, availability.slots.some(slot => slot.available));
      }
      assert.deepEqual(calendar.days.map(row => row.available), [false, false, false, true]);
      await prisma.timeBlock.delete({ where: { id: block.id } });
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { maximumAdvanceDays: 1, minimumNoticeMinutes: 0 } });
      const bounded = await getBusinessBookingCalendar(context, service.id, day(2), 2, controlledNow);
      assert.ok(bounded.days.every(row => !row.available));
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { maximumAdvanceDays: 30 } });
    });
    await t.test('owned reschedule calendar stays private and uses historical duration after unpublishing', async () => {
      const startsAt = new Date(`${start}T09:00Z`), endsAt = new Date(startsAt.getTime() + 1800000);
      const booked = await prisma.booking.create({ data: { businessId: business.id, customerId: person.id, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', idempotencyKey: randomUUID() } });
      await prisma.service.update({ where: { id: service.id }, data: { active: false, durationMinutes: 120 } });
      await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } });
      assert.equal((await app.inject({ url: path() })).statusCode, 404);
      const url = `/api/bookings/${booked.id}/booking-calendar?fromDate=${start}&days=2`;
      assert.equal((await app.inject({ url })).statusCode, 401);
      const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
      const result = await app.inject({ url, headers }); assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().days[0].available, true);
      assert.equal(result.json().days[1].available, false);
      assert.equal((await app.inject({ url: url + '&serviceId=' + foreign.id, headers })).statusCode, 400);
      await prisma.session.updateMany({ where: { identityId: person.id }, data: { revokedAt: new Date() } });
      assert.equal((await app.inject({ url, headers })).statusCode, 401);
    });
  } finally { await app.close(); await prisma.booking.deleteMany({ where: { businessId: business.id } }); await prisma.business.deleteMany({ where: { id: { in: [business.id, hidden.id] } } }); await prisma.identity.delete({ where: { id: person.id } }); }
});

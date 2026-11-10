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
import { HISTORY_PAGE_SIZE, encodeHistoryCursor } from '../src/repositories/AppointmentHistory.service.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

const DAY_MS = 86400000, HALF_HOUR_MS = 1800000;
// More than two pages, so a middle page is walked too.
const PAST_COUNT = 2 * HISTORY_PAGE_SIZE + 5;
// Rows that share one start, so the cursor must break ties by id.
const TIED_COUNT = 3;

test('past appointments page newest first, without gaps or repeats, and never show upcoming or foreign rows', async t => {
  const run = randomUUID(), token = randomUUID(), otherToken = randomUUID();
  const customer = await prisma.identity.create({ data: { email: `history-${run}@example.test` } });
  const other = await prisma.identity.create({ data: { email: `history-other-${run}@example.test` } });
  const [first, second] = await Promise.all(['first', 'second'].map(name => prisma.business.create({ data: { name: `History ${name}`, slug: `history-${name}-${run}`, approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } })));
  const setup = async (businessId: string) => {
    const staff = await prisma.staff.create({ data: { businessId, displayName: 'History staff', parallelCapacity: 100 } });
    const service = await prisma.service.create({ data: { businessId, name: 'History service', durationMinutes: 30, priceMinor: 9000, currency: 'ILS' } });
    await prisma.staffService.create({ data: { businessId, staffId: staff.id, serviceId: service.id } });
    await prisma.bookingPolicy.create({ data: { businessId, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
    return { businessId, staffId: staff.id, serviceId: service.id };
  };
  const places = { first: await setup(first!.id), second: await setup(second!.id) };
  for (const [identityId, value] of [[customer.id, token], [other.id, otherToken]] as const) await prisma.session.create({ data: { identityId, tokenHash: tokenDigest(value), expiresAt: new Date(Date.now() + 600000) } });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: error instanceof AppError ? error.code : 'INVALID' }));
  await registerBookingRoutes(app);
  const headers = { authorization: `Bearer ${token}`, 'x-visit-client': 'native' };
  const url = '/v1/me/bookings/history';
  const create = (id: string, startsAt: Date, { customerId = customer.id, place = places.first }: { customerId?: string; place?: typeof places.first } = {}) => {
    const endsAt = new Date(+startsAt + HALF_HOUR_MS);
    return prisma.booking.create({ data: { id: `${run}-${id}`, ...place, customerId, status: 'CONFIRMED', startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: randomUUID(), serviceName: 'History service', serviceDurationMinutes: 30, servicePriceMinor: 9000, serviceCurrency: 'ILS' } });
  };
  const walk = async (query = '') => {
    const ids: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const response = await app.inject({ url: `${url}?${new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(query ? { businessId: query } : {}) })}`, headers });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json() as { bookings: { id: string }[]; nextCursor: string | null };
      assert.ok(body.bookings.length <= HISTORY_PAGE_SIZE);
      ids.push(...body.bookings.map(booking => booking.id)); cursor = body.nextCursor; pages++;
    } while (cursor);
    return { ids, pages };
  };
  try {
    await t.test('a customer with no past appointments gets an explicit empty page; signed-out reads fail', async () => {
      assert.equal((await app.inject({ url })).statusCode, 401);
      const response = await app.inject({ url, headers });
      assert.deepEqual(response.json(), { bookings: [], nextCursor: null });
    });

    const now = Date.now(), tiedStart = new Date(now - 10 * DAY_MS);
    const expected: { id: string; startsAt: Date }[] = [];
    for (let index = 0; index < PAST_COUNT - TIED_COUNT; index++) expected.push(await create(`past-${index}`, new Date(now - (index + 1) * DAY_MS - HALF_HOUR_MS)));
    for (let index = 0; index < TIED_COUNT; index++) expected.push(await create(`tie-${index}`, tiedStart));
    // A future appointment the customer cancelled is history, though it has not happened.
    const cancelled = await create('cancelled-future', new Date(now + 3 * DAY_MS));
    expected.push(await prisma.booking.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } }));
    const upcoming = await create('upcoming', new Date(now + 2 * DAY_MS));
    const foreign = await create('foreign', new Date(now - 4 * DAY_MS), { customerId: other.id });
    const elsewhere = await Promise.all([1, 2].map(index => create(`elsewhere-${index}`, new Date(now - index * DAY_MS), { place: places.second })));
    expected.push(...elsewhere);
    const order = [...expected].sort((a, b) => +b.startsAt - +a.startsAt || (a.id < b.id ? 1 : -1)).map(booking => booking.id);

    await t.test('pages walk every past appointment once, newest first, ties broken by id', async () => {
      const first = (await app.inject({ url, headers })).json() as { bookings: { id: string; business: { id: string; name: string; timezone: string }; service: { name: string } }[]; nextCursor: string };
      assert.equal(first.bookings.length, HISTORY_PAGE_SIZE);
      assert.equal(first.bookings[0]!.id, cancelled.id);
      assert.deepEqual(Object.keys(first.bookings[0]!.business).sort(), ['id', 'name', 'timezone']);
      assert.equal(first.bookings[0]!.service.name, 'History service');
      const { ids, pages } = await walk();
      assert.deepEqual(ids, order);
      assert.equal(pages, Math.ceil(order.length / HISTORY_PAGE_SIZE));
    });
    await t.test('upcoming appointments and other customers\' appointments never appear', async () => {
      const { ids } = await walk();
      assert.equal(ids.includes(upcoming.id), false);
      assert.equal(ids.includes(foreign.id), false);
      const theirs = await app.inject({ url, headers: { ...headers, authorization: `Bearer ${otherToken}` } });
      assert.deepEqual(theirs.json().bookings.map((booking: { id: string }) => booking.id), [foreign.id]);
    });
    await t.test('the business filter keeps only that business, still paged', async () => {
      const { ids } = await walk(second!.id);
      assert.deepEqual(ids, order.filter(id => elsewhere.some(booking => booking.id === id)));
    });
    await t.test('a malformed or altered cursor is refused, not read as "from the start"', async () => {
      for (const cursor of ['not-a-cursor', encodeHistoryCursor({ startsAt: tiedStart, id: 'x' }).slice(0, -2), Buffer.from('yesterday|id').toString('base64url')]) {
        const response = await app.inject({ url: `${url}?${new URLSearchParams({ cursor })}`, headers });
        assert.equal(response.statusCode, 400, cursor);
      }
      assert.equal((await app.inject({ url: `${url}?page=2`, headers })).statusCode, 400);
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { id: { startsWith: run } } }).catch(() => undefined);
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import { registerScreenFlows } from '../src/routes/screen-flows.js';
import { localDateTimeToInstant } from '../src/scheduling/local-time.js';
import { CUSTOMER_CARD_EXISTS, CUSTOMER_CARD_SUGGESTIONS } from '../src/repositories/CustomerCards.service.js';
import { CUSTOMER_SEARCH_MIN_DIGITS, CUSTOMER_SEARCH_MIN_LETTERS } from '@visit/contracts';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

type Card = { id: string; name: string | null; phone: string | null; email: string | null; linked: boolean };

test('customer cards: tenant-scoped search, save, pick, linked own bookings and one ownership scope', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { slug: `cards-${run}`, name: 'Cards business', timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const foreign = await prisma.business.create({ data: { slug: `cards-foreign-${run}`, name: 'Other business', timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const person = (label: string, data = {}) => prisma.identity.create({ data: { email: `cards-${label}-${run}@example.test`, ...data } });
  const [owner, staffMember, customer, stranger, neverBooked] = await Promise.all([person('owner'), person('staff'), person('customer', { displayName: 'Dana Customer', emailVerifiedAt: new Date() }), person('stranger'), person('never', { displayName: 'Dana Neverbooked', emailVerifiedAt: new Date() })]);
  await prisma.membership.createMany({ data: [{ businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' }, { businessId: business.id, identityId: staffMember.id, role: 'STAFF', status: 'ACTIVE' }, { businessId: foreign.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' }] });
  const tokens = new Map<string, string>();
  for (const identity of [owner, staffMember, customer, stranger]) { const token = randomUUID(); tokens.set(identity.id, token); await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } }); }
  const headers = (identity = owner) => ({ authorization: `Bearer ${tokens.get(identity.id)}`, 'x-visit-client': 'native' });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Specialist', parallelCapacity: 5 } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Haircut', durationMinutes: 30, priceMinor: 8000, currency: 'ILS' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 365, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '08:00', endLocal: '20:00' })) });
  const foreignCard = await prisma.customerCard.create({ data: { businessId: foreign.id, name: 'Dana Foreign', phone: '+972501111111' } });

  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { code: error instanceof AppError ? error.code : 'INVALID', details: error instanceof AppError ? error.details : undefined } }));
  await registerProviderRoutes(app); await registerBookingRoutes(app); await registerScreenFlows(app);
  let day = 10;
  const nextDate = () => new Date(Date.now() + day++ * 86400000).toISOString().slice(0, 10);
  const reviewedService = { name: service.name, durationMinutes: 30, priceMinor: 8000, currency: 'ILS' };
  const manual = (extra: object) => app.inject({ method: 'POST', url: `/v1/provider/businesses/${business.id}/manual-bookings`, headers: headers(), payload: { finalConsent: true, idempotencyKey: randomUUID(), serviceId: service.id, staffId: staff.id, localDate: nextDate(), localTime: '10:00', reviewedService, ...extra } });
  const search = (q: string, identity = owner, businessId = business.id) => app.inject({ url: `/v1/provider/businesses/${businessId}/customer-cards?q=${encodeURIComponent(q)}`, headers: headers(identity) });
  const cards = async (q: string) => { const response = await search(q); assert.equal(response.statusCode, 200, response.body); return response.json<{ cards: Card[] }>().cards; };

  try {
    let danaCardId = '';
    await t.test('saving a new customer creates one card and books on it (criteria 2, 3)', async () => {
      const response = await manual({ customerName: 'Dana Walkin', customerPhone: '+972501234567', customerEmail: `dana-${run}@example.test`, saveCustomer: true });
      assert.equal(response.statusCode, 200, response.body);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: response.json<{ id: string }>().id } });
      const card = await prisma.customerCard.findFirstOrThrow({ where: { businessId: business.id, phone: '+972501234567' } });
      danaCardId = card.id;
      assert.equal(booking.customerCardId, card.id); assert.equal(booking.customerId, null); assert.equal(card.identityId, null);
      assert.deepEqual(response.json<{ customerCard: { id: string } }>().customerCard, { id: card.id });
    });

    await t.test('the same phone is offered as the existing card, and the refusal does not spend the attempt (criterion 3)', async () => {
      const idempotencyKey = randomUUID();
      const response = await manual({ idempotencyKey, customerName: 'Someone Else', customerPhone: '+972501234567', saveCustomer: true });
      assert.equal(response.statusCode, 409, response.body);
      const error = response.json<{ error: { code: string; details: { card: Card } } }>().error;
      assert.equal(error.code, CUSTOMER_CARD_EXISTS); assert.equal(error.details.card.id, danaCardId); assert.equal(error.details.card.name, 'Dana Walkin');
      assert.equal(await prisma.customerCard.count({ where: { businessId: business.id, phone: '+972501234567' } }), 1);
      const picked = await manual({ idempotencyKey, customerName: 'Someone Else', customerPhone: '+972501234567', customerCardId: danaCardId });
      assert.equal(picked.statusCode, 200, picked.body);
    });

    await t.test('two simultaneous saves of one new phone make one card; the other is offered it, never a server error', async () => {
      const responses = await Promise.all(['10:00', '12:00'].map(localTime => manual({ localTime, customerName: 'Race Person', customerPhone: '+972506543210', saveCustomer: true })));
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409], responses.map(response => response.body).join(' '));
      assert.equal(responses.find(response => response.statusCode === 409)?.json<{ error: { code: string } }>().error.code, CUSTOMER_CARD_EXISTS);
      assert.equal(await prisma.customerCard.count({ where: { businessId: business.id, phone: '+972506543210' } }), 1);
    });

    await t.test('a retried save that committed recovers its booking instead of reporting a duplicate', async () => {
      const body = { idempotencyKey: randomUUID(), localDate: nextDate(), customerName: 'Retry Person', customerPhone: '+972507777777', saveCustomer: true };
      const first = await manual(body), second = await manual(body);
      assert.equal(first.statusCode, 200, first.body); assert.equal(second.statusCode, 200, second.body);
      assert.equal(second.json<{ id: string }>().id, first.json<{ id: string }>().id);
    });

    await t.test('picking a card fills the snapshot from the card; another business\'s card is not found (criterion 2)', async () => {
      const response = await manual({ customerName: 'Typed Over', customerPhone: '+972509999999', customerCardId: danaCardId });
      assert.equal(response.statusCode, 200, response.body);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: response.json<{ id: string }>().id } });
      assert.equal(booking.customerCardId, danaCardId); assert.equal(booking.customerName, 'Dana Walkin'); assert.equal(booking.customerPhone, '+972501234567'); assert.equal(booking.customerEmail, `dana-${run}@example.test`);
      assert.equal((await manual({ customerName: 'X Y', customerPhone: '+972501111111', customerCardId: foreignCard.id })).statusCode, 404);
      assert.equal((await manual({ customerName: 'X Y', customerPhone: '+972501111111', customerCardId: danaCardId, saveCustomer: true })).statusCode, 400);
    });

    await t.test('save off keeps today\'s behaviour: snapshots and no card (criterion 4)', async () => {
      const response = await manual({ customerName: 'Unsaved Guest', customerPhone: '+972508888888' });
      assert.equal(response.statusCode, 200, response.body);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: response.json<{ id: string }>().id } });
      assert.equal(booking.customerCardId, null); assert.equal(booking.customerName, 'Unsaved Guest');
      assert.equal(await prisma.customerCard.count({ where: { businessId: business.id, phone: '+972508888888' } }), 0);
    });

    let ownBookingId = '';
    await t.test('an app customer\'s own booking creates a linked card, suggested afterwards (criterion 9)', async () => {
      assert.deepEqual((await cards('Dana')).map(card => card.name), ['Dana Walkin']);
      const startsAt = localDateTimeToInstant(nextDate(), '12:00', business.timezone).toISOString();
      const committed = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers: headers(customer), payload: { finalConsent: true, providerId: business.id, serviceId: service.id, staffId: staff.id, startsAt, idempotencyKey: randomUUID(), reviewedService } });
      assert.equal(committed.statusCode, 200, committed.body);
      ownBookingId = committed.json<{ id: string }>().id;
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: ownBookingId }, include: { customerCard: true } });
      assert.equal(booking.customerCard?.identityId, customer.id); assert.ok(booking.customerCard?.linkedAt);
      const found = await cards('dana');
      assert.deepEqual(found.map(card => [card.name, card.linked]), [['Dana Customer', true], ['Dana Walkin', false]]);
      assert.equal(found[0]?.email, customer.email); assert.equal(found[0]?.phone, null);
      // A second own booking reuses the card.
      const again = await app.inject({ method: 'POST', url: '/api/bookings/commit', headers: headers(customer), payload: { finalConsent: true, providerId: business.id, serviceId: service.id, staffId: staff.id, startsAt: localDateTimeToInstant(nextDate(), '12:00', business.timezone).toISOString(), idempotencyKey: randomUUID(), reviewedService } });
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(await prisma.customerCard.count({ where: { businessId: business.id, identityId: customer.id } }), 1);
    });

    await t.test('search is this business\'s cards only, by name or phone digits, for owners and managers (criterion 1)', async () => {
      const names = (await cards('dana')).map(card => card.name);
      assert.equal(names.includes('Dana Foreign'), false); assert.equal(names.includes('Dana Neverbooked'), false);
      assert.deepEqual(await cards('d'.repeat(CUSTOMER_SEARCH_MIN_LETTERS - 1)), []);
      assert.deepEqual(await cards('1'.repeat(CUSTOMER_SEARCH_MIN_DIGITS - 1)), []);
      assert.ok((await cards('050')).some(card => card.id === danaCardId), 'a local prefix at the threshold matches without its 0');
      assert.deepEqual((await cards('050-123')).map(card => card.id), [danaCardId]);
      assert.deepEqual((await cards('+97250123')).map(card => card.id), [danaCardId]);
      assert.deepEqual(await cards('%%'), []);
      assert.deepEqual(await cards('__'), []);
      await prisma.membership.updateMany({ where: { businessId: business.id, identityId: staffMember.id }, data: { role: 'MANAGER' } });
      assert.equal((await search('dana', staffMember)).statusCode, 200);
      await prisma.membership.updateMany({ where: { businessId: business.id, identityId: staffMember.id }, data: { status: 'REVOKED' } });
      assert.equal((await search('dana', staffMember)).statusCode, 403);
      await prisma.membership.updateMany({ where: { businessId: business.id, identityId: staffMember.id }, data: { role: 'STAFF', status: 'ACTIVE' } });
      assert.equal((await search('dana', staffMember)).statusCode, 403);
      // An account that never booked here is not found by its phone either.
      const neverBookedPhone = `+97250${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      await prisma.identity.update({ where: { id: neverBooked.id }, data: { phone: neverBookedPhone, phoneVerifiedAt: new Date() } });
      assert.deepEqual((await cards(`0${neverBookedPhone.slice(4)}`)).filter(card => card.phone === neverBookedPhone), []);
      // The owner of another business sees only that business's cards.
      assert.deepEqual((await cards('dana')).some(card => card.id === foreignCard.id), false);
      const foreignSearch = await search('dana', owner, foreign.id); assert.equal(foreignSearch.statusCode, 200);
      assert.deepEqual(foreignSearch.json<{ cards: Card[] }>().cards.map(card => card.id), [foreignCard.id]);
      assert.equal((await search('dana', stranger)).statusCode, 403);
      assert.equal((await app.inject({ url: `/v1/provider/businesses/${business.id}/customer-cards?q=dana` })).statusCode, 401);
      for (let index = 0; index < CUSTOMER_CARD_SUGGESTIONS + 2; index++) await prisma.customerCard.create({ data: { businessId: business.id, name: `Bulk Person ${index}`, phone: `+97252${String(index).padStart(7, '0')}` } });
      assert.equal((await cards('bulk')).length, CUSTOMER_CARD_SUGGESTIONS);
    });

    await t.test('a linked card\'s business-entered bookings are the linked person\'s, and nobody else\'s (criterion 7, scope)', async () => {
      const response = await manual({ customerName: 'Dana Walkin', customerPhone: '+972501234567', customerCardId: danaCardId, localTime: '14:00' });
      assert.equal(response.statusCode, 200, response.body);
      const id = response.json<{ id: string }>().id;
      const asCustomer = (method: 'GET' | 'POST', url: string, payload?: object, identity = customer) => app.inject({ method, url, headers: headers(identity), ...(payload ? { payload } : {}) });
      assert.equal((await asCustomer('GET', `/v1/bookings/${id}/details`)).statusCode, 404);
      // The claim (PR B) is the only way a typed card gets linked; the test sets it directly.
      await prisma.customerCard.update({ where: { id: danaCardId }, data: { identityId: stranger.id, linkedAt: new Date() } });
      const cardBookings = (await prisma.booking.findMany({ where: { customerCardId: danaCardId }, select: { id: true } })).map(row => row.id);
      const listed = (await asCustomer('GET', '/v1/me/bookings', undefined, stranger)).json<{ bookings: { id: string }[] }>().bookings.map(row => row.id);
      assert.deepEqual([...listed].sort(), [...cardBookings].sort());
      const upcoming = (await asCustomer('GET', '/v1/me/bookings/upcoming', undefined, stranger)).json<{ booking: { id: string }; additionalCount: number }>();
      assert.ok(cardBookings.includes(upcoming.booking.id)); assert.equal(upcoming.additionalCount, cardBookings.length - 1);
      const details = await asCustomer('GET', `/v1/bookings/${id}/details`, undefined, stranger);
      assert.equal(details.statusCode, 200, details.body);
      assert.equal((await asCustomer('GET', `/v1/bookings/${id}/history`, undefined, stranger)).statusCode, 200);
      assert.equal((await asCustomer('GET', `/v1/bookings/${id}/details`)).statusCode, 404);
      assert.equal((await asCustomer('POST', `/v1/bookings/${id}/cancel`, {})).statusCode, 404);
      assert.equal((await asCustomer('GET', `/v1/bookings/${ownBookingId}/details`, undefined, stranger)).statusCode, 404);
      // An app booking is its booker's alone, even if its card were ever linked to someone else.
      const ownCard = await prisma.customerCard.findFirstOrThrow({ where: { businessId: business.id, identityId: customer.id } });
      await prisma.customerCard.update({ where: { id: ownCard.id }, data: { identityId: staffMember.id } });
      assert.equal((await asCustomer('GET', `/v1/bookings/${ownBookingId}/details`, undefined, staffMember)).statusCode, 404);
      assert.equal((await asCustomer('POST', `/v1/bookings/${ownBookingId}/cancel`, {}, staffMember)).statusCode, 404);
      await prisma.customerCard.update({ where: { id: ownCard.id }, data: { identityId: customer.id } });
      assert.equal((await asCustomer('GET', `/v1/bookings/${ownBookingId}/details`)).statusCode, 200);
      const revision = details.json<{ revision: number }>().revision;
      const startsAt = localDateTimeToInstant(nextDate(), '15:00', business.timezone).toISOString();
      const moved = await asCustomer('POST', `/v1/bookings/${id}/reschedule`, { finalConsent: true, idempotencyKey: randomUUID(), expectedRevision: revision, staffId: staff.id, startsAt }, stranger);
      assert.equal(moved.statusCode, 200, moved.body);
      const cancelled = await asCustomer('POST', `/v1/bookings/${id}/cancel`, { expectedRevision: moved.json<{ revision: number }>().revision }, stranger);
      assert.equal(cancelled.statusCode, 200, cancelled.body);
      const history = await asCustomer('GET', '/v1/me/bookings/history', undefined, stranger);
      assert.ok(history.body.includes(id));
      // The lists carry the appointment, never the business's side of the row: actor, fingerprint, key, notes, typed contacts, card.
      for (const url of ['/v1/me/bookings', '/v1/me/bookings/history']) {
        const row = (await asCustomer('GET', url, undefined, stranger)).json<{ bookings: Record<string, unknown>[] }>().bookings.find(item => item.id === id);
        assert.ok(row, url);
        for (const key of ['enteredByIdentityId', 'manualFingerprint', 'manualReason', 'idempotencyKey', 'customerName', 'customerPhone', 'customerEmail', 'customerCardId', 'customerId', 'occupiedFrom', 'source']) assert.equal(key in row, false, `${url} ${key}`);
      }
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id } });
      assert.equal(booking.customerId, null); assert.equal(booking.source, 'MANUAL'); assert.equal(booking.customerName, 'Dana Walkin');
      // Unlinking (PR B) takes it out again: the scope reads the card's link at request time.
      await prisma.customerCard.update({ where: { id: danaCardId }, data: { identityId: null, linkedAt: null } });
      assert.equal((await asCustomer('GET', `/v1/bookings/${id}/details`, undefined, stranger)).statusCode, 404);
      assert.equal((await asCustomer('GET', '/v1/me/bookings/history', undefined, stranger)).body.includes(id), false);
    });

    await t.test('the guards stay: customerId cannot be set on a manual booking, and a card cannot point across businesses', async () => {
      const booking = await prisma.booking.findFirstOrThrow({ where: { businessId: business.id, customerCardId: danaCardId } });
      await assert.rejects(prisma.booking.update({ where: { id: booking.id }, data: { customerId: customer.id } }), 'guard 0');
      await assert.rejects(prisma.booking.update({ where: { id: booking.id }, data: { customerCardId: foreignCard.id } }), 'guard 1');
      await assert.rejects(prisma.customerCard.create({ data: { businessId: business.id, name: 'Duplicate', phone: '+972501234567' } }), 'guard 2');
      await assert.rejects(prisma.customerCard.create({ data: { businessId: business.id, name: 'No phone' } }), 'guard 3');
    });
  } finally { await app.close(); }
});

// The migration drops its backfill function after its one run; the test recreates it from the migration itself.
const backfillSql = readFileSync(new URL('../prisma/migrations/20261111130100_customer_cards_backfill/migration.sql', import.meta.url), 'utf8');
const backfillFunction = backfillSql.slice(backfillSql.indexOf('CREATE FUNCTION'), backfillSql.indexOf('END $$;') + 'END $$;'.length).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
async function runBackfill(businessId: string) {
  await prisma.$executeRawUnsafe(backfillFunction);
  await prisma.$executeRaw`SELECT visit_backfill_customer_cards(${businessId})`;
}

test('the backfill makes one card per guest phone and per app customer, and a second run changes nothing (criterion 11)', async () => {
  const run = randomUUID();
  const owner = await prisma.identity.create({ data: { email: `backfill-owner-${run}@example.test` } });
  const customer = await prisma.identity.create({ data: { email: `backfill-customer-${run}@example.test` } });
  const business = await prisma.business.create({ data: { slug: `backfill-${run}`, name: 'Backfill business', timezone: 'UTC', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Staff', parallelCapacity: 20 } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Visit', durationMinutes: 30 } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.membership.create({ data: { businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
  const session = await prisma.session.create({ data: { identityId: owner.id, tokenHash: tokenDigest(randomUUID()), expiresAt: new Date(Date.now() + 600000) } });
  let offset = 1;
  const slot = () => { const startsAt = new Date(Date.now() + offset++ * 3600000); startsAt.setUTCSeconds(0, 0); const endsAt = new Date(+startsAt + 1800000); return { startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt }; };
  // Legacy rows as they exist before the migration: written the way the manual and customer flows write them.
  const legacyManual = async (name: string, phone: string) => {
    const key = `manual:${owner.id}:${randomUUID()}`, fingerprint = 'a'.repeat(64);
    await prisma.manualBookingAttempt.create({ data: { businessId: business.id, actorId: owner.id, idempotencyKey: key, fingerprint } });
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('visit.booking_actor', ${owner.id}, true), set_config('visit.booking_source', 'MANUAL', true), set_config('visit.booking_reason', 'MANUAL_ENTRY', true), set_config('visit.booking_session', ${session.id}, true)`;
      await tx.booking.create({ data: { businessId: business.id, source: 'MANUAL', enteredByIdentityId: owner.id, manualFingerprint: fingerprint, customerName: name, customerPhone: phone, staffId: staff.id, serviceId: service.id, ...slot(), idempotencyKey: key, status: 'CONFIRMED' } });
    });
  };
  await legacyManual('First Name', '+972501000001');
  await legacyManual('Latest Name', '+972501000001');
  await legacyManual('Other Guest', '+972501000002');
  const own = (customerId: string, status: 'CONFIRMED' | 'HELD') => prisma.booking.create({ data: { businessId: business.id, customerId, staffId: staff.id, serviceId: service.id, ...slot(), idempotencyKey: randomUUID(), status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 600000) : null } });
  await own(customer.id, 'CONFIRMED');
  const cancelled = await own(customer.id, 'CONFIRMED'); await prisma.booking.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
  // A hold that expired, and one released without confirming (it ends CANCELLED too): neither is a customer of this business.
  const expired = await own(owner.id, 'HELD'); await prisma.booking.update({ where: { id: expired.id }, data: { status: 'EXPIRED', holdExpiresAt: null } });
  const released = await own(owner.id, 'HELD'); await prisma.booking.update({ where: { id: released.id }, data: { status: 'CANCELLED', holdExpiresAt: null } });

  const snapshot = async () => ({
    cards: await prisma.customerCard.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }),
    bookings: await prisma.booking.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' }, select: { id: true, customerCardId: true, updatedAt: true, revision: true } }),
    events: await prisma.bookingEvent.count({ where: { businessId: business.id } }),
  });
  await runBackfill(business.id);
  const once = await snapshot();
  const guests = once.cards.filter(card => !card.identityId), linked = once.cards.filter(card => card.identityId);
  assert.deepEqual(guests.map(card => [card.phone, card.name]).sort(), [['+972501000001', 'Latest Name'], ['+972501000002', 'Other Guest']]);
  assert.deepEqual(linked.map(card => card.identityId), [customer.id]);
  const byBooking = await prisma.booking.findMany({ where: { businessId: business.id }, select: { source: true, status: true, customerPhone: true, customerId: true, customerCardId: true } });
  for (const booking of byBooking) {
    if (booking.source === 'MANUAL') assert.equal(booking.customerCardId, guests.find(card => card.phone === booking.customerPhone)?.id);
    else if (booking.customerId === owner.id) assert.equal(booking.customerCardId, null);
    else assert.equal(booking.customerCardId, linked[0]?.id);
  }
  await runBackfill(business.id);
  assert.deepEqual(await snapshot(), once);
  await prisma.$executeRaw`DROP FUNCTION IF EXISTS visit_backfill_customer_cards(TEXT)`;
  const functions = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_proc WHERE proname = 'visit_backfill_customer_cards'`;
  assert.equal(Number(functions[0]?.count), 0);
});

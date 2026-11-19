import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { closeLiveSignals, signalAppointmentChanged } from '../src/infra/live-signals.js';
import { redis } from '../src/infra/redis.js';
import { setBookingAudit } from '../src/repositories/BookingLifecycle.service.js';
import { WORKER_NOTIFICATION_KINDS } from '../src/repositories/Notifications.service.js';
import { tokenDigest } from '../src/security/sessions.js';
import { expectCustomerSignal } from './support/live-signal.js';
import { memberPreset } from '../src/security/business-permissions.js';

after(async () => { closeLiveSignals(); redis.disconnect(); await prisma.$disconnect(); });

const DAY_MS = 86400000;
const OUTCOME_KINDS = ['BOOKING_COMPLETED', 'BOOKING_NO_SHOW'] as const;
type Inbox = { kind: string; audience: string; booking: { id: string; customerName: string | null } | null }[];

// Slice 4 (worker-access.md): a booking, move or cancellation on a worker's linked row also notifies that worker.
test('a worker is notified of their own calendar only', async t => {
  const run = randomUUID();
  const business = await prisma.business.create({ data: { name: 'Worker inbox', slug: `worker-inbox-${run}`, timezone: 'UTC', approvalStatus: 'APPROVED', publishedAt: new Date(), location: 'Synthetic' } });
  const names = ['owner', 'manager', 'worker', 'colleague', 'customer', 'dual', 'removed', 'unlinked', 'archived', 'linkedManager'] as const;
  const people = Object.fromEntries(await Promise.all(names.map(async name => [name, await prisma.identity.create({ data: { email: `worker-inbox-${name}-${run}@example.test`, emailVerifiedAt: new Date(), displayName: name } })] as const))) as Record<typeof names[number], { id: string }>;
  const tokens = new Map<string, string>();
  for (const person of Object.values(people)) {
    const token = randomUUID(); tokens.set(person.id, token);
    await prisma.session.create({ data: { identityId: person.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  }
  const cut = await prisma.service.create({ data: { businessId: business.id, name: 'Cut', durationMinutes: 30, priceMinor: 8000, currency: 'ILS' } });
  const rowNames = ['own', 'other', 'dualRow', 'removedRow', 'unlinkedRow', 'archivedRow', 'managerRow'] as const;
  const rows = Object.fromEntries(await Promise.all(rowNames.map(async name => [name, await prisma.staff.create({ data: { businessId: business.id, displayName: name } })] as const))) as Record<typeof rowNames[number], { id: string }>;
  await prisma.staffService.createMany({ data: Object.values(rows).map(row => ({ businessId: business.id, staffId: row.id, serviceId: cut.id })) });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0, requireCustomerName: false, requireVerifiedPhone: false, requireVerifiedEmail: false } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  await prisma.membership.createMany({ data: [
    { businessId: business.id, identityId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    { businessId: business.id, identityId: people.manager.id, ...memberPreset('MANAGER'), status: 'ACTIVE' },
    { businessId: business.id, identityId: people.worker.id, ...memberPreset('STAFF'), status: 'ACTIVE', staffId: rows.own.id },
    { businessId: business.id, identityId: people.colleague.id, ...memberPreset('STAFF'), status: 'ACTIVE', staffId: rows.other.id },
    // One membership per person since slice 5: a member who sees every calendar (one switch) and is linked to a row
    // is told as a manager and as that row's worker by the trigger's two inserts: one notification, never two.
    { businessId: business.id, identityId: people.dual.id, ...memberPreset('STAFF'), seeAllCalendars: true, status: 'ACTIVE', staffId: rows.dualRow.id },
    { businessId: business.id, identityId: people.removed.id, ...memberPreset('STAFF'), status: 'REVOKED', staffId: rows.removedRow.id },
    { businessId: business.id, identityId: people.unlinked.id, ...memberPreset('STAFF'), status: 'ACTIVE' },
    { businessId: business.id, identityId: people.archived.id, ...memberPreset('STAFF'), status: 'ACTIVE', staffId: rows.archivedRow.id },
    // A manager linked to a calendar: told once, as a manager.
    { businessId: business.id, identityId: people.linkedManager.id, ...memberPreset('MANAGER'), status: 'ACTIVE', staffId: rows.managerRow.id },
  ] });
  await prisma.staff.update({ where: { id: rows.archivedRow.id }, data: { archivedAt: new Date() } });

  let hour = 0;
  const date = new Date(Date.now() + 3 * DAY_MS).toISOString().slice(0, 10);
  const slot = (day = date) => { const at = hour++; const startsAt = new Date(`${day}T${String(at).padStart(2, '0')}:00:00Z`); return { startsAt, endsAt: new Date(+startsAt + 1800000) }; };
  /** Books by the customer, as a booking through the public flow would, so the customer is the actor. */
  const book = async (staffId: string, day = date) => {
    const { startsAt, endsAt } = slot(day);
    return prisma.$transaction(async tx => {
      await setBookingAudit(tx, people.customer.id, 'CUSTOMER', 'FINAL_CONSENT');
      return tx.booking.create({ data: { businessId: business.id, customerId: people.customer.id, serviceId: cut.id, staffId, idempotencyKey: randomUUID(), startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', serviceName: 'Cut', serviceDurationMinutes: 30 } });
    });
  };
  const change = (actorId: string, bookingId: string, data: Parameters<typeof prisma.booking.update>[0]['data']) => prisma.$transaction(async tx => {
    await setBookingAudit(tx, actorId, 'PROVIDER', 'PROVIDER_REQUEST');
    return tx.booking.update({ where: { id: bookingId }, data });
  });
  const recipients = async (bookingId: string, kind: string) => (await prisma.notification.findMany({ where: { bookingId, kind }, select: { identityId: true, audience: true } })).map(row => `${row.identityId}:${row.audience}`).sort();
  const as = (who: { id: string }, audience = 'BUSINESS') => `${who.id}:${audience}`;
  const managers = [as(people.owner), as(people.manager), as(people.dual), as(people.linkedManager)];
  const expected = (...extra: string[]) => [...managers, ...extra].sort();

  const app = await createApp();
  const headers = (who: { id: string }) => ({ authorization: `Bearer ${tokens.get(who.id)}`, 'x-visit-client': 'native' });
  const inbox = async (who: { id: string }) => { const response = await app.inject({ url: '/api/me/notifications', headers: headers(who) }); assert.equal(response.statusCode, 200, response.body); return response.json<{ notifications: Inbox }>().notifications; };
  const unread = async (who: { id: string }) => (await app.inject({ url: '/api/me/notifications/unread', headers: headers(who) })).json<{ unread: number }>().unread;
  const base = `/v1/provider/businesses/${business.id}`;

  try {
    await t.test('a booking on their row tells the worker, besides the owners and managers', async () => {
      const booking = await book(rows.own.id);
      assert.deepEqual(await recipients(booking.id, 'BOOKING_CONFIRMED'), expected(as(people.worker)));
    });

    await t.test('a cancellation on their row tells the worker', async () => {
      const booking = await book(rows.own.id);
      await change(people.owner.id, booking.id, { status: 'CANCELLED' });
      assert.deepEqual(await recipients(booking.id, 'BOOKING_CANCELLED'), [as(people.customer, 'CUSTOMER'), ...managers.filter(row => row !== as(people.owner)), as(people.worker)].sort());
    });

    await t.test('a move between rows tells both workers; a move within a row tells only its worker', async () => {
      const booking = await book(rows.own.id), { startsAt, endsAt } = slot();
      await change(people.owner.id, booking.id, { staffId: rows.other.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt });
      assert.deepEqual(await recipients(booking.id, 'BOOKING_RESCHEDULED'), [as(people.customer, 'CUSTOMER'), ...managers.filter(row => row !== as(people.owner)), as(people.worker), as(people.colleague)].sort());
      const within = await book(rows.other.id), later = slot();
      await change(people.owner.id, within.id, { startsAt: later.startsAt, endsAt: later.endsAt, occupiedFrom: later.startsAt, occupiedUntil: later.endsAt });
      assert.deepEqual(await recipients(within.id, 'BOOKING_RESCHEDULED'), [as(people.customer, 'CUSTOMER'), ...managers.filter(row => row !== as(people.owner)), as(people.colleague)].sort());
    });

    await t.test('outcomes are not sent to the worker', async () => {
      for (const kind of OUTCOME_KINDS) assert.ok(!WORKER_NOTIFICATION_KINDS.includes(kind), kind);
      const past = new Date(Date.now() - 2 * DAY_MS).toISOString().slice(0, 10);
      const finished = await book(rows.own.id, past), absent = await book(rows.own.id, past);
      await change(people.owner.id, finished.id, { status: 'COMPLETED' });
      await change(people.owner.id, absent.id, { status: 'NO_SHOW' });
      assert.ok(!(await recipients(finished.id, 'BOOKING_COMPLETED')).includes(as(people.worker)));
      assert.ok(!(await recipients(absent.id, 'BOOKING_NO_SHOW')).includes(as(people.worker)));
      assert.ok((await recipients(absent.id, 'BOOKING_NO_SHOW')).includes(as(people.manager)), 'managers keep every kind');
    });

    await t.test('one row per person: a linked member who sees every calendar, a linked manager, and a worker who is the customer', async () => {
      for (const row of [rows.dualRow, rows.managerRow]) {
        const booking = await book(row.id);
        assert.deepEqual(await recipients(booking.id, 'BOOKING_CONFIRMED'), expected());
        assert.equal(await prisma.notification.count({ where: { bookingId: booking.id, identityId: { in: [people.dual.id, people.linkedManager.id] } } }), 2);
      }
      const { startsAt, endsAt } = slot();
      const ownAppointment = await prisma.$transaction(async tx => {
        await setBookingAudit(tx, people.worker.id, 'CUSTOMER', 'FINAL_CONSENT');
        return tx.booking.create({ data: { businessId: business.id, customerId: people.worker.id, serviceId: cut.id, staffId: rows.own.id, idempotencyKey: randomUUID(), startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', serviceName: 'Cut', serviceDurationMinutes: 30 } });
      });
      await change(people.owner.id, ownAppointment.id, { status: 'CANCELLED' });
      assert.deepEqual((await recipients(ownAppointment.id, 'BOOKING_CANCELLED')).filter(row => row.startsWith(people.worker.id)), [as(people.worker, 'CUSTOMER')]);
    });

    await t.test('a removed, an unlinked, and an archived-row worker get nothing', async () => {
      for (const row of [rows.removedRow, rows.archivedRow]) {
        const booking = await book(row.id);
        assert.deepEqual(await recipients(booking.id, 'BOOKING_CONFIRMED'), expected());
      }
      assert.equal(await prisma.notification.count({ where: { identityId: { in: [people.removed.id, people.unlinked.id, people.archived.id] } } }), 0);
    });

    await t.test('the person who acted is not told', async () => {
      const booking = await book(rows.own.id);
      await change(people.worker.id, booking.id, { status: 'CANCELLED' });
      assert.ok(!(await recipients(booking.id, 'BOOKING_CANCELLED')).includes(as(people.worker)));
    });

    await t.test('through the API: the owner books, moves and the worker cancels on their own row', async () => {
      const owner = headers(people.owner);
      const added = await app.inject({ method: 'POST', url: `${base}/manual-bookings`, headers: owner, payload: { finalConsent: true, idempotencyKey: randomUUID(), serviceId: cut.id, staffId: rows.own.id, localDate: date, localTime: '20:00', customerName: 'Walk in', customerPhone: '+972509999999', reviewedService: { name: 'Cut', durationMinutes: 30, priceMinor: 8000, currency: 'ILS' } } });
      assert.equal(added.statusCode, 200, added.body);
      const bookingId = added.json<{ id: string }>().id;
      const seen = (await inbox(people.worker)).find(row => row.booking?.id === bookingId);
      assert.deepEqual([seen?.kind, seen?.audience, seen?.booking?.customerName], ['BOOKING_CONFIRMED', 'BUSINESS', 'Walk in']);
      const { revision } = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const moved = await app.inject({ method: 'POST', url: `${base}/bookings/${bookingId}/reschedule`, headers: owner, payload: { finalConsent: true, idempotencyKey: randomUUID(), expectedRevision: revision, staffId: rows.other.id, localDate: date, localTime: '21:00' } });
      assert.equal(moved.statusCode, 200, moved.body);
      for (const who of [people.worker, people.colleague]) assert.ok((await inbox(who)).some(row => row.booking?.id === bookingId && row.kind === 'BOOKING_RESCHEDULED'), who.id);
      const cancelled = await app.inject({ method: 'POST', url: `${base}/bookings/${bookingId}/cancel`, headers: headers(people.colleague), payload: {} });
      assert.equal(cancelled.statusCode, 200, cancelled.body);
      assert.ok(!(await inbox(people.colleague)).some(row => row.booking?.id === bookingId && row.kind === 'BOOKING_CANCELLED'), 'the colleague cancelled it');
      assert.ok(!(await inbox(people.worker)).some(row => row.booking?.id === bookingId && row.kind === 'BOOKING_CANCELLED'), 'no longer the worker\'s row');
      assert.ok((await inbox(people.owner)).some(row => row.booking?.id === bookingId && row.kind === 'BOOKING_CANCELLED'));
    });

    await t.test('the inbox never shows another row, an outcome, or an approval to a worker', async () => {
      const theirs = await book(rows.other.id);
      const event = await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: theirs.id } });
      // Rows the trigger never writes, planted to prove the read checks the row and the kind by itself.
      await prisma.notification.createMany({ data: [
        { identityId: people.worker.id, businessId: business.id, kind: 'BOOKING_CONFIRMED', audience: 'BUSINESS', bookingId: theirs.id, eventId: event.id },
        { identityId: people.worker.id, businessId: business.id, kind: 'BUSINESS_APPROVED', audience: 'BUSINESS' },
      ] });
      const past = new Date(Date.now() - 3 * DAY_MS).toISOString().slice(0, 10), mine = await book(rows.own.id, past);
      await change(people.owner.id, mine.id, { status: 'COMPLETED' });
      const completed = await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: mine.id, kind: 'COMPLETED' } });
      await prisma.notification.create({ data: { identityId: people.worker.id, businessId: business.id, kind: 'BOOKING_COMPLETED', audience: 'BUSINESS', bookingId: mine.id, eventId: completed.id } });
      const rowsShown = await inbox(people.worker);
      assert.ok(!rowsShown.some(row => row.booking?.id === theirs.id), 'another row');
      assert.ok(rowsShown.every(row => WORKER_NOTIFICATION_KINDS.includes(row.kind)), 'outcomes and approvals');
      assert.ok(rowsShown.length > 0);
      assert.equal(await unread(people.worker), rowsShown.length, 'the count hides the same rows');
    });

    await t.test('unlinking, archiving the row, revoking or relinking hides what the worker was told', async () => {
      const shown = (await inbox(people.worker)).filter(row => row.audience === 'BUSINESS').length;
      assert.ok(shown > 0);
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.worker.id } });
      const hidden = async (label: string) => { assert.equal((await inbox(people.worker)).filter(row => row.audience === 'BUSINESS').length, 0, label); };
      await prisma.membership.update({ where: { id: membership.id }, data: { status: 'REVOKED' } }); await hidden('revoked');
      await prisma.membership.update({ where: { id: membership.id }, data: { status: 'ACTIVE', staffId: null } }); await hidden('unlinked');
      await prisma.membership.update({ where: { id: membership.id }, data: { staffId: rows.unlinkedRow.id } }); await hidden('relinked to another row');
      await prisma.membership.update({ where: { id: membership.id }, data: { staffId: rows.own.id } });
      await prisma.staff.update({ where: { id: rows.own.id }, data: { archivedAt: new Date() } }); await hidden('row archived');
      await prisma.staff.update({ where: { id: rows.own.id }, data: { archivedAt: null } });
      assert.equal((await inbox(people.worker)).filter(row => row.audience === 'BUSINESS').length, shown, 'relinked: shown again');
    });

    await t.test('marking read works for a worker and leaves another row\'s planted notification alone', async () => {
      const shown = await inbox(people.worker);
      const marked = await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: headers(people.worker), payload: { ids: shown.map(row => (row as unknown as { id: string }).id) } });
      assert.equal(marked.statusCode, 200, marked.body);
      assert.equal(marked.json<{ unread: number }>().unread, 0);
      const planted = await prisma.notification.findMany({ where: { identityId: people.worker.id, readAt: null }, select: { id: true } });
      assert.ok(planted.length >= 1, 'the hidden rows stay unread');
      const named = await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: headers(people.worker), payload: { ids: planted.map(row => row.id) } });
      assert.equal(named.statusCode, 200, named.body);
      assert.equal(await prisma.notification.count({ where: { id: { in: planted.map(row => row.id) }, readAt: null } }), planted.length, 'naming a hidden row does not mark it');
    });

    await t.test('a customer moving or cancelling their own booking tells the row\'s worker', async () => {
      const booking = await book(rows.own.id), { startsAt, endsAt } = slot();
      const asCustomer = (data: Parameters<typeof prisma.booking.update>[0]['data']) => prisma.$transaction(async tx => {
        await setBookingAudit(tx, people.customer.id, 'CUSTOMER', 'FINAL_CONSENT');
        return tx.booking.update({ where: { id: booking.id }, data });
      });
      await asCustomer({ startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt });
      await asCustomer({ status: 'CANCELLED' });
      for (const kind of ['BOOKING_RESCHEDULED', 'BOOKING_CANCELLED']) assert.deepEqual(await recipients(booking.id, kind), expected(as(people.worker)), kind);
    });

    await t.test('a pending linked membership gets nothing and reads nothing', async () => {
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.colleague.id } });
      await prisma.membership.update({ where: { id: membership.id }, data: { status: 'PENDING' } });
      try {
        const booking = await book(rows.other.id);
        assert.deepEqual(await recipients(booking.id, 'BOOKING_CONFIRMED'), expected());
        assert.equal((await inbox(people.colleague)).filter(row => row.audience === 'BUSINESS').length, 0);
      } finally { await prisma.membership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } }); }
    });

    await t.test('a deleted or unapproved business hides a worker\'s notifications', async () => {
      assert.ok((await inbox(people.colleague)).some(row => row.audience === 'BUSINESS'));
      for (const data of [{ deletedAt: new Date() }, { approvalStatus: 'PENDING' as const }]) {
        await prisma.business.update({ where: { id: business.id }, data });
        assert.equal((await inbox(people.colleague)).filter(row => row.audience === 'BUSINESS').length, 0, JSON.stringify(data));
        assert.equal(await unread(people.colleague), 0, JSON.stringify(data));
        await prisma.business.update({ where: { id: business.id }, data: { deletedAt: null, approvalStatus: 'APPROVED' } });
      }
    });

    await t.test('a worker linked in one business hears nothing from another where they are unlinked', async () => {
      const second = await prisma.business.create({ data: { name: 'Second', slug: `worker-inbox-second-${run}`, timezone: 'UTC', approvalStatus: 'APPROVED', publishedAt: new Date(), location: 'Synthetic' } });
      try {
        const row = await prisma.staff.create({ data: { businessId: second.id, displayName: 'Elsewhere' } });
        const service = await prisma.service.create({ data: { businessId: second.id, name: 'Cut', durationMinutes: 30 } });
        await prisma.bookingPolicy.create({ data: { businessId: second.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0, requireCustomerName: false, requireVerifiedPhone: false, requireVerifiedEmail: false } });
        await prisma.membership.create({ data: { businessId: second.id, identityId: people.worker.id, ...memberPreset('STAFF'), status: 'ACTIVE' } });
        const { startsAt, endsAt } = slot();
        const booking = await prisma.$transaction(async tx => {
          await setBookingAudit(tx, people.customer.id, 'CUSTOMER', 'FINAL_CONSENT');
          return tx.booking.create({ data: { businessId: second.id, customerId: people.customer.id, serviceId: service.id, staffId: row.id, idempotencyKey: randomUUID(), startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', serviceName: 'Cut', serviceDurationMinutes: 30 } });
        });
        assert.equal(await prisma.notification.count({ where: { bookingId: booking.id, identityId: people.worker.id } }), 0);
        assert.ok(!(await inbox(people.worker)).some(row => row.booking?.id === booking.id));
      } finally {
        await prisma.booking.deleteMany({ where: { businessId: second.id } });
        await prisma.businessAccessEvent.deleteMany({ where: { businessId: second.id } });
        await prisma.business.delete({ where: { id: second.id } });
      }
    });

    await t.test('the trigger writes worker rows for exactly the kinds the read allows', async () => {
      const [{ source }] = await prisma.$queryRaw<{ source: string }[]>`SELECT prosrc AS source FROM pg_proc WHERE proname = 'visit_notify_booking_event'`;
      assert.ok(source.includes(`notification_kind IN (${WORKER_NOTIFICATION_KINDS.map(kind => `'${kind}'`).join(',')})`));
    });

    await t.test('a change wakes a linked worker\'s bell', async () => {
      await expectCustomerSignal(people.worker.id, async () => signalAppointmentChanged({ businessId: business.id, customerId: null }));
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.businessAccessEvent.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.deleteMany({ where: { id: { in: Object.values(people).map(p => p.id) } } });
  }
});

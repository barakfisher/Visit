import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../src/db/client.js';
import type { BookingStatus } from '../src/generated/prisma/client.js';
import { AppError } from '../src/http/errors.js';
import { closeLiveSignals, signalAppointmentChanged } from '../src/infra/live-signals.js';
import { redis } from '../src/infra/redis.js';
import { setBookingAudit } from '../src/repositories/BookingLifecycle.service.js';
import { NOTIFICATION_LIST_LIMIT, NOTIFICATION_READ_LIMIT } from '../src/repositories/Notifications.service.js';
import { registerNotifications } from '../src/routes/notifications.js';
import { registerProviderRoutes } from '../src/routes/providers.js';
import { newOpaqueToken, sessionExpiry, tokenDigest } from '../src/security/sessions.js';
import { expectCustomerSignal } from './support/live-signal.js';

after(async () => { closeLiveSignals(); redis.disconnect(); await prisma.$disconnect(); });

const HOUR_MS = 3600000;

async function person(name: string) {
  const identity = await prisma.identity.create({ data: { email: `inbox-${name}-${randomUUID()}@example.test`, displayName: 'Dana' } }), token = newOpaqueToken();
  const session = await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: sessionExpiry() } });
  return { id: identity.id, sessionId: session.id, headers: { cookie: `visit_session=${token}` } };
}

async function scene() {
  const key = randomUUID();
  const business = await prisma.business.create({ data: { slug: `inbox-${key}`, name: 'Inbox studio', approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const staffRow = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Noa', parallelCapacity: 50 } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Haircut', durationMinutes: 30 } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staffRow.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0, requireCustomerName: false, requireVerifiedPhone: false, requireVerifiedEmail: false } });
  const [owner, manager, staff, revoked, customer, outsider] = await Promise.all(['owner', 'manager', 'staff', 'revoked', 'customer', 'outsider'].map(person)) as [Awaited<ReturnType<typeof person>>, Awaited<ReturnType<typeof person>>, Awaited<ReturnType<typeof person>>, Awaited<ReturnType<typeof person>>, Awaited<ReturnType<typeof person>>, Awaited<ReturnType<typeof person>>];
  await prisma.membership.createMany({ data: [
    { identityId: owner.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' },
    { identityId: manager.id, businessId: business.id, role: 'MANAGER', status: 'ACTIVE' },
    { identityId: staff.id, businessId: business.id, role: 'STAFF', status: 'ACTIVE' },
    { identityId: revoked.id, businessId: business.id, role: 'MANAGER', status: 'REVOKED' },
  ] });
  const book = async (actorId: string | null, { status = 'CONFIRMED', customerId = customer.id as string | null, startsIn = 72 * HOUR_MS }: { status?: BookingStatus; customerId?: string | null; startsIn?: number } = {}) => {
    const startsAt = new Date(Date.now() + startsIn), endsAt = new Date(+startsAt + HOUR_MS / 2);
    return prisma.$transaction(async tx => {
      if (actorId) await setBookingAudit(tx, actorId, 'CUSTOMER', 'FINAL_CONSENT');
      return tx.booking.create({ data: { businessId: business.id, staffId: staffRow.id, serviceId: service.id, customerId, status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + HOUR_MS) : null, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: randomUUID(), serviceName: 'Haircut', serviceDurationMinutes: 30 } });
    });
  };
  const enterByHand = (actor: { id: string; sessionId: string }) => prisma.$transaction(async tx => {
    await setBookingAudit(tx, actor.id, 'MANUAL', 'MANUAL_ENTRY');
    await tx.$queryRaw`SELECT set_config('visit.booking_session', ${actor.sessionId}, true)`;
    const startsAt = new Date(Date.now() + 72 * HOUR_MS), endsAt = new Date(+startsAt + HOUR_MS / 2), idempotencyKey = randomUUID(), fingerprint = randomBytes(32).toString('hex');
    await tx.manualBookingAttempt.create({ data: { businessId: business.id, actorId: actor.id, idempotencyKey, fingerprint } });
    return tx.booking.create({ data: { businessId: business.id, staffId: staffRow.id, serviceId: service.id, customerId: null, source: 'MANUAL', enteredByIdentityId: actor.id, manualFingerprint: fingerprint, customerName: 'Walk-in', customerPhone: '+972599123456', status: 'CONFIRMED', startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey, serviceName: 'Haircut', serviceDurationMinutes: 30 } });
  });
  const change = (actorId: string | null, bookingId: string, data: Parameters<typeof prisma.booking.update>[0]['data']) => prisma.$transaction(async tx => {
    if (actorId) await setBookingAudit(tx, actorId, 'PROVIDER', 'PROVIDER_REQUEST');
    return tx.booking.update({ where: { id: bookingId }, data });
  });
  const recipients = async (bookingId: string, kind: string) => (await prisma.notification.findMany({ where: { bookingId, kind }, select: { identityId: true, audience: true } })).map(row => `${row.identityId}:${row.audience}`).sort();
  return { business, owner, manager, staff, revoked, customer, outsider, book, enterByHand, change, recipients };
}

const as = (who: { id: string }, audience: string) => `${who.id}:${audience}`;
const sorted = (...values: string[]) => [...values].sort();

async function inboxApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: error instanceof AppError ? error.code : 'INVALID' }));
  registerNotifications(app);
  return app;
}

test('booking events notify the right people', async t => {
  const s = await scene();
  await t.test('a customer booking tells the customer who made it and the managers, not staff', async () => {
    const booking = await s.book(s.customer.id);
    assert.deepEqual(await s.recipients(booking.id, 'BOOKING_CONFIRMED'), sorted(as(s.customer, 'CUSTOMER'), as(s.owner, 'BUSINESS'), as(s.manager, 'BUSINESS')));
  });
  await t.test('a customer cancelling or moving their own appointment is told too', async () => {
    const cancelled = await s.book(s.customer.id);
    await s.change(s.customer.id, cancelled.id, { status: 'CANCELLED' });
    assert.deepEqual(await s.recipients(cancelled.id, 'BOOKING_CANCELLED'), sorted(as(s.customer, 'CUSTOMER'), as(s.owner, 'BUSINESS'), as(s.manager, 'BUSINESS')));
    const moved = await s.book(s.customer.id);
    const startsAt = new Date(+moved.startsAt + HOUR_MS), endsAt = new Date(+moved.endsAt + HOUR_MS);
    await s.change(s.customer.id, moved.id, { startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt });
    assert.deepEqual(await s.recipients(moved.id, 'BOOKING_RESCHEDULED'), sorted(as(s.customer, 'CUSTOMER'), as(s.owner, 'BUSINESS'), as(s.manager, 'BUSINESS')));
  });
  await t.test('a manager cancelling tells the customer and the other manager, not themself', async () => {
    const booking = await s.book(s.customer.id);
    await s.change(s.manager.id, booking.id, { status: 'CANCELLED' });
    assert.deepEqual(await s.recipients(booking.id, 'BOOKING_CANCELLED'), sorted(as(s.customer, 'CUSTOMER'), as(s.owner, 'BUSINESS')));
  });
  await t.test('a change with no actor tells everyone', async () => {
    const booking = await s.book(s.customer.id);
    await s.change(null, booking.id, { status: 'CANCELLED' });
    assert.deepEqual(await s.recipients(booking.id, 'BOOKING_CANCELLED'), sorted(as(s.customer, 'CUSTOMER'), as(s.owner, 'BUSINESS'), as(s.manager, 'BUSINESS')));
  });
  await t.test('a move, a completion and a no-show each notify; a change that moves nothing does not', async () => {
    const moved = await s.book(s.customer.id);
    const startsAt = new Date(+moved.startsAt + HOUR_MS), endsAt = new Date(+moved.endsAt + HOUR_MS);
    await s.change(s.owner.id, moved.id, { startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt });
    assert.deepEqual(await s.recipients(moved.id, 'BOOKING_RESCHEDULED'), sorted(as(s.customer, 'CUSTOMER'), as(s.manager, 'BUSINESS')));
    const before = await prisma.notification.count({ where: { bookingId: moved.id } });
    await s.change(s.owner.id, moved.id, { holdExpiresAt: null });
    assert.equal(await prisma.notification.count({ where: { bookingId: moved.id } }), before);
    const finished = await s.book(s.customer.id, { startsIn: -2 * HOUR_MS }), absent = await s.book(s.customer.id, { startsIn: -2 * HOUR_MS });
    await s.change(s.owner.id, finished.id, { status: 'COMPLETED' });
    await s.change(s.owner.id, absent.id, { status: 'NO_SHOW' });
    assert.deepEqual(await s.recipients(finished.id, 'BOOKING_COMPLETED'), sorted(as(s.customer, 'CUSTOMER'), as(s.manager, 'BUSINESS')));
    assert.deepEqual(await s.recipients(absent.id, 'BOOKING_NO_SHOW'), sorted(as(s.customer, 'CUSTOMER'), as(s.manager, 'BUSINESS')));
  });
  await t.test('holding and expiring are internal: only the confirmation notifies', async () => {
    const expired = await s.book(s.customer.id, { status: 'HELD' });
    assert.equal(await prisma.notification.count({ where: { bookingId: expired.id } }), 0);
    await s.change(null, expired.id, { status: 'EXPIRED', holdExpiresAt: null });
    assert.equal(await prisma.notification.count({ where: { bookingId: expired.id } }), 0);
    const released = await s.book(s.customer.id, { status: 'HELD' });
    await s.change(s.customer.id, released.id, { status: 'CANCELLED', holdExpiresAt: null });
    assert.equal(await prisma.notification.count({ where: { bookingId: released.id } }), 0);
    const confirmed = await s.book(s.customer.id, { status: 'HELD' });
    await s.change(s.customer.id, confirmed.id, { status: 'CONFIRMED', holdExpiresAt: null });
    assert.deepEqual(await s.recipients(confirmed.id, 'BOOKING_CONFIRMED'), sorted(as(s.customer, 'CUSTOMER'), as(s.owner, 'BUSINESS'), as(s.manager, 'BUSINESS')));
  });
  await t.test('a manager who is the customer of the booking gets one row, as the customer', async () => {
    const booking = await s.book(s.manager.id, { customerId: s.manager.id });
    await s.change(s.owner.id, booking.id, { status: 'CANCELLED' });
    assert.deepEqual(await s.recipients(booking.id, 'BOOKING_CANCELLED'), [as(s.manager, 'CUSTOMER')]);
    const own = await s.book(s.manager.id, { customerId: s.manager.id });
    await s.change(s.manager.id, own.id, { status: 'CANCELLED' });
    assert.deepEqual(await s.recipients(own.id, 'BOOKING_CANCELLED'), sorted(as(s.manager, 'CUSTOMER'), as(s.owner, 'BUSINESS')), 'acting on their own booking, they are its customer and are told as one');
  });
  await t.test('an appointment entered by hand has no customer to tell', async () => {
    const booking = await s.enterByHand(s.owner);
    assert.deepEqual(await s.recipients(booking.id, 'BOOKING_CONFIRMED'), [as(s.manager, 'BUSINESS')]);
  });
  await t.test('a change wakes the managers and the customer', async () => {
    for (const person of [s.owner, s.manager, s.customer]) await expectCustomerSignal(person.id, async () => signalAppointmentChanged({ businessId: s.business.id, customerId: s.customer.id }));
  });
});

test('the inbox API', async t => {
  const s = await scene(), app = await inboxApp();
  t.after(() => app.close());
  const list = async (who: { headers: Record<string, string> }) => (await app.inject({ url: '/api/me/notifications', headers: who.headers })).json().notifications as { id: string; kind: string; read: boolean; audience: string; booking: { customerName: string | null; serviceName: string; startsAt: string; previousStartsAt: string | null } | null; business: { name: string } }[];
  const unread = async (who: { headers: Record<string, string> }) => (await app.inject({ url: '/api/me/notifications/unread', headers: who.headers })).json().unread as number;
  const markRead = (who: { headers: Record<string, string> }, ids: string[]) => app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: who.headers, payload: { ids } });

  await t.test('needs a session', async () => {
    for (const [method, url] of [['GET', '/api/me/notifications'], ['GET', '/api/me/notifications/unread'], ['POST', '/api/me/notifications/read']] as const) assert.equal((await app.inject({ method, url, ...(method === 'POST' ? { payload: { ids: ['x'] } } : {}) })).statusCode, 401, url);
  });
  await t.test('an empty inbox is explicit', async () => {
    assert.deepEqual(await list(s.outsider), []); assert.equal(await unread(s.outsider), 0);
  });
  const booking = await s.book(s.customer.id);
  await s.change(s.manager.id, booking.id, { status: 'CANCELLED' });
  await t.test('says what happened and names the business; only the business sees the customer name', async () => {
    const [forCustomer] = await list(s.customer), rows = await list(s.owner);
    assert.equal(forCustomer!.kind, 'BOOKING_CANCELLED'); assert.equal(forCustomer!.business.name, s.business.name);
    assert.equal(forCustomer!.booking!.customerName, null); assert.equal(forCustomer!.booking!.serviceName, 'Haircut');
    assert.deepEqual(rows.map(row => row.kind), ['BOOKING_CANCELLED', 'BOOKING_CONFIRMED']);
    assert.equal(rows[0]!.booking!.customerName, 'Dana');
    assert.equal(await unread(s.owner), 2);
  });
  await t.test('one person cannot read or mark another person\'s notifications', async () => {
    const [row] = await list(s.owner);
    assert.deepEqual(await list(s.outsider), []);
    assert.equal((await markRead(s.outsider, [row!.id])).statusCode, 200);
    assert.equal(await unread(s.owner), 2);
  });
  await t.test('rejects a query or a body it does not expect', async () => {
    assert.equal((await app.inject({ url: `/api/me/notifications?identityId=${s.owner.id}`, headers: s.outsider.headers })).statusCode, 400);
    assert.equal((await markRead(s.owner, [])).statusCode, 400);
    assert.equal((await markRead(s.owner, Array.from({ length: NOTIFICATION_READ_LIMIT + 1 }, (_, index) => `id-${index}`))).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: s.owner.headers, payload: { ids: ['x'], identityId: s.outsider.id } })).statusCode, 400);
  });
  await t.test('what was shown becomes read, and something newer stays unread', async () => {
    const shown = await list(s.manager);
    const later = await s.book(s.customer.id);
    assert.equal((await markRead(s.manager, shown.map(row => row.id))).json().unread, 1);
    const rows = await list(s.manager);
    assert.deepEqual(rows.filter(row => !row.read).map(row => row.kind), ['BOOKING_CONFIRMED']);
    assert.equal(await prisma.notification.count({ where: { identityId: s.manager.id, bookingId: later.id, readAt: null } }), 1);
  });
  await t.test('losing a role hides the business\'s notifications, and a customer\'s own stay', async () => {
    const before = await unread(s.owner), customerBefore = await unread(s.customer); assert.ok(before > 0); assert.ok(customerBefore > 0);
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { status: 'REVOKED' } });
    assert.deepEqual(await list(s.owner), []); assert.equal(await unread(s.owner), 0);
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { status: 'ACTIVE', role: 'STAFF' } });
    assert.deepEqual(await list(s.owner), [], 'a staff role is not a managing role');
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { role: 'OWNER' } });
    assert.equal(await unread(s.owner), before);
    assert.equal(await unread(s.customer), customerBefore);
  });
  await t.test('a pending member, and a business that is not approved, show nothing', async () => {
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { status: 'PENDING' } });
    assert.deepEqual(await list(s.owner), []); assert.equal(await unread(s.owner), 0);
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { status: 'ACTIVE' } });
    for (const approvalStatus of ['PENDING', 'REJECTED'] as const) {
      await prisma.business.update({ where: { id: s.business.id }, data: { approvalStatus } });
      assert.deepEqual(await list(s.owner), [], approvalStatus); assert.equal(await unread(s.owner), 0, approvalStatus);
    }
    await prisma.business.update({ where: { id: s.business.id }, data: { approvalStatus: 'APPROVED' } });
  });
  await t.test('the answer names whose inbox it is', async () => {
    assert.equal((await app.inject({ url: '/api/me/notifications', headers: s.outsider.headers })).json().identityId, s.outsider.id);
  });
  await t.test('marking leaves alone what the person cannot see, and rows it did not name', async () => {
    const rows = await list(s.owner);
    const hidden = await prisma.notification.findFirstOrThrow({ where: { identityId: s.owner.id, audience: 'BUSINESS', readAt: null }, select: { id: true } });
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { status: 'REVOKED' } });
    await markRead(s.owner, rows.map(row => row.id));
    await prisma.membership.updateMany({ where: { identityId: s.owner.id, businessId: s.business.id }, data: { status: 'ACTIVE' } });
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: hidden.id } })).readAt, null);
    // Older than what was named, with the list not full: this one may have committed late, unseen.
    const older = await prisma.notification.create({ data: { identityId: s.owner.id, businessId: s.business.id, kind: 'BUSINESS_APPROVED', audience: 'BUSINESS', createdAt: new Date(Date.now() - 24 * HOUR_MS) } });
    await markRead(s.owner, [hidden.id]);
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: older.id } })).readAt, null);
  });
  await t.test('a deleted business hides its managers\' notifications only', async () => {
    const customerBefore = await unread(s.customer); assert.ok(customerBefore > 0);
    await prisma.business.update({ where: { id: s.business.id }, data: { deletedAt: new Date() } });
    assert.deepEqual(await list(s.manager), []); assert.equal(await unread(s.manager), 0);
    assert.equal(await unread(s.customer), customerBefore);
    await prisma.business.update({ where: { id: s.business.id }, data: { deletedAt: null } });
  });
});

test('the list has a limit, and reading it also clears what the limit left out', async () => {
  const s = await scene(), app = await inboxApp();
  try {
    const now = Date.now(), total = NOTIFICATION_LIST_LIMIT + 3;
    await prisma.notification.createMany({ data: Array.from({ length: total }, (_, index) => ({ identityId: s.outsider.id, businessId: s.business.id, kind: 'BUSINESS_REJECTED', audience: 'CUSTOMER', createdAt: new Date(now - index * 1000) })) });
    const { notifications } = (await app.inject({ url: '/api/me/notifications', headers: s.outsider.headers })).json() as { notifications: { id: string }[] };
    assert.equal(notifications.length, NOTIFICATION_LIST_LIMIT);
    const read = await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: s.outsider.headers, payload: { ids: notifications.map(row => row.id) } });
    assert.equal(read.json().unread, 0);
    // A row tied with the last one shown would otherwise stay unread, out of reach.
    const last = await prisma.notification.findUniqueOrThrow({ where: { id: notifications.at(-1)!.id } });
    await prisma.notification.updateMany({ where: { identityId: s.outsider.id }, data: { readAt: null } });
    await prisma.notification.create({ data: { identityId: s.outsider.id, businessId: s.business.id, kind: 'BUSINESS_REJECTED', audience: 'CUSTOMER', createdAt: last.createdAt } });
    await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: s.outsider.headers, payload: { ids: notifications.map(row => row.id) } });
    assert.equal((await app.inject({ url: '/api/me/notifications/unread', headers: s.outsider.headers })).json().unread, 0);
  } finally { await app.close(); }
});

test('a provider decision reaches the applicant, once', async t => {
  const suffix = randomUUID(), scopeName = `test:inbox:${suffix}`;
  const app = await inboxApp();
  await registerProviderRoutes(app, { reviewScope: scopeName });
  t.after(() => app.close());
  const applicant = await person('applicant');
  const admin = await person('admin');
  await prisma.identity.update({ where: { id: admin.id }, data: { platformRole: 'ADMIN' } });
  const apply = async () => {
    const slug = `inbox-apply-${randomUUID()}`;
    const applied = await app.inject({ method: 'POST', url: '/v1/provider-applications', headers: applicant.headers, payload: { businessName: 'Applying studio', slug } });
    assert.equal(applied.statusCode, 201, applied.body);
    return { id: applied.json().id as string, businessId: (await prisma.business.findUniqueOrThrow({ where: { slug } })).id };
  };
  const decide = (id: string, decision: string) => app.inject({ method: 'POST', url: `/v1/admin/provider-applications/${id}/decision`, headers: admin.headers, payload: { decision, reason: 'Reviewed the new business evidence.' } });
  const inbox = async () => (await app.inject({ url: '/api/me/notifications', headers: applicant.headers })).json().notifications as { kind: string; audience: string; business: { id: string } }[];

  await t.test('approval is a business notification, and repeating the decision adds nothing', async () => {
    const item = await apply();
    await expectCustomerSignal(applicant.id, async () => assert.equal((await decide(item.id, 'APPROVED')).statusCode, 200));
    assert.equal((await decide(item.id, 'APPROVED')).statusCode, 200);
    assert.deepEqual((await inbox()).map(row => [row.kind, row.audience, row.business.id]), [['BUSINESS_APPROVED', 'BUSINESS', item.businessId]]);
  });
  await t.test('a rejection stays readable although it revokes the membership', async () => {
    const item = await apply();
    assert.equal((await decide(item.id, 'REJECTED')).statusCode, 200);
    assert.equal((await decide(item.id, 'REJECTED')).statusCode, 200);
    assert.equal(await prisma.notification.count({ where: { identityId: applicant.id, businessId: item.businessId } }), 1);
    assert.deepEqual((await inbox())[0], { ...(await inbox())[0], kind: 'BUSINESS_REJECTED', audience: 'CUSTOMER' });
  });
});

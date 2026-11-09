import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { LIVE_HEARTBEAT_MS, LIVE_SILENCE_LIMIT_MS } from '@visit/contracts';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { env } from '../src/env.js';
import { AppError } from '../src/http/errors.js';
import { closeLiveSignals, personTopic, LIVE_SUBSCRIBER_NAME, publishLiveSignal, signalAgendaChanged } from '../src/infra/live-signals.js';
import { redis } from '../src/infra/redis.js';
import { changeBookingOutcome } from '../src/repositories/BookingLifecycle.service.js';
import { revokeMember } from '../src/repositories/business-access.js';
import { createBusinessStaff, removeBusinessStaff, updateBusinessStaff } from '../src/repositories/provider-settings.js';
import { changingAgenda, createTimeBlock, deleteTimeBlock } from '../src/repositories/TimeBlocks.service.js';
import { AGENDA_CHANGED_EVENT, APPOINTMENTS_CHANGED_EVENT, LIVE_READY_EVENT, LIVE_SIGNAL_COALESCE_MS, MAX_LIVE_STREAMS_PER_IDENTITY, registerLiveStreaming, registerLiveUpdates } from '../src/routes/live-updates.js';
import { authenticate, tokenDigest } from '../src/security/sessions.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { expectAgendaSignal, expectCustomerSignal, expectNoAgendaSignal } from './support/live-signal.js';

const WAIT_MS = 3000, QUIET_MS = LIVE_SIGNAL_COALESCE_MS * 3, SHUTDOWN_WAIT_MS = 15000;
after(async () => { closeLiveSignals(); redis.disconnect(); await prisma.$disconnect(); });

type Stream = { status: number; events: string[]; body: string; waitFor: (event: string) => Promise<void>; ended: Promise<void>; close: () => void };

const open = (baseUrl: string, businessId: string, token?: string) => openPath(`${baseUrl}/api/provider/agenda/live?businessId=${encodeURIComponent(businessId)}`, token);

async function openPath(url: string, token?: string): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { accept: 'text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: controller.signal });
  const stream: Stream = { status: response.status, events: [], body: '', waitFor: async () => {}, ended: Promise.resolve(), close: () => controller.abort() };
  if (response.status !== 200) { stream.body = await response.text(); return stream; }
  const waiting: { event: string; done: () => void }[] = [];
  const settle = () => { for (const wait of [...waiting]) if (stream.events.includes(wait.event)) { waiting.splice(waiting.indexOf(wait), 1); wait.done(); } };
  stream.ended = (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body!) {
        stream.body += decoder.decode(chunk as Uint8Array, { stream: true });
        stream.events = [...stream.body.matchAll(/^event: (.+)$/gm)].map(match => match[1]!);
        settle();
      }
    } catch { /* The test aborted its own request. */ }
  })();
  stream.waitFor = event => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} event; saw ${stream.events.join(',')}`)), WAIT_MS);
    waiting.push({ event, done: () => { clearTimeout(timer); resolve(); } }); settle();
  });
  return stream;
}
const endsWithin = (stream: Stream, ms = WAIT_MS) => Promise.race([stream.ended.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))]);
const quiet = () => new Promise(resolve => setTimeout(resolve, QUIET_MS));

test('the live agenda stream', async t => {
  const key = randomUUID();
  const business = await prisma.business.create({ data: { slug: `live-${key}`, name: 'Live', approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const foreign = await prisma.business.create({ data: { slug: `live-foreign-${key}`, name: 'Foreign', approvalStatus: 'APPROVED', publishedAt: new Date(), timezone: 'Asia/Jerusalem' } });
  const person = async (name: string, role?: 'OWNER' | 'MANAGER' | 'STAFF', expiresIn = 600000) => {
    const identity = await prisma.identity.create({ data: { email: `live-${name}-${key}@example.test` } }), token = randomUUID();
    if (role) await prisma.membership.create({ data: { businessId: business.id, identityId: identity.id, role, status: 'ACTIVE' } });
    const session = await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + expiresIn) } });
    return { identity, token, session };
  };
  const owner = await person('owner', 'OWNER'), staffMember = await person('staff', 'STAFF'), outsider = await person('outsider');
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 400).send({ error: { code: error instanceof AppError ? error.code : 'INVALID' } }));
  await registerLiveStreaming(app);
  let holdHandler: Promise<void> | null = null;
  app.addHook('preHandler', async () => { if (holdHandler) await holdHandler; });
  registerLiveUpdates(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    await t.test('tolerates two late heartbeats before a client gives up', () => {
      assert.ok(LIVE_SILENCE_LIMIT_MS > 2 * LIVE_HEARTBEAT_MS);
    });

    await t.test('refuses anyone who may not read the agenda, as ordinary JSON', async () => {
      const anonymous = await open(baseUrl, business.id), staff = await open(baseUrl, business.id, staffMember.token), stranger = await open(baseUrl, business.id, outsider.token);
      assert.equal(anonymous.status, 401); assert.equal(staff.status, 403); assert.equal(stranger.status, 403);
      assert.equal(JSON.parse(stranger.body).error.code, 'FORBIDDEN');
    });

    await t.test('announces readiness, then a change, and carries no appointment data', async () => {
      const stream = await open(baseUrl, business.id, owner.token);
      assert.equal(stream.status, 200);
      await stream.waitFor(LIVE_READY_EVENT);
      signalAgendaChanged(business.id);
      await stream.waitFor(AGENDA_CHANGED_EVENT);
      assert.equal(stream.body.replaceAll(': heartbeat\n\n', ''), `event: ${LIVE_READY_EVENT}\ndata: {}\n\nevent: ${AGENDA_CHANGED_EVENT}\ndata: {}\n\n`);
      stream.close();
    });

    await t.test('a burst of changes arrives as one signal', async () => {
      const stream = await open(baseUrl, business.id, owner.token);
      await stream.waitFor(LIVE_READY_EVENT);
      for (let index = 0; index < 5; index++) signalAgendaChanged(business.id);
      await stream.waitFor(AGENDA_CHANGED_EVENT); await quiet();
      assert.deepEqual(stream.events, [LIVE_READY_EVENT, AGENDA_CHANGED_EVENT]);
      stream.close();
    });

    await t.test('never tells one business about another', async () => {
      const stream = await open(baseUrl, business.id, owner.token);
      await stream.waitFor(LIVE_READY_EVENT);
      signalAgendaChanged(foreign.id); await quiet();
      assert.deepEqual(stream.events, [LIVE_READY_EVENT]);
      stream.close();
    });

    await t.test('a revoked session gets no further signal and loses the stream', async () => {
      const other = await person('revoked', 'OWNER');
      const stream = await open(baseUrl, business.id, other.token);
      await stream.waitFor(LIVE_READY_EVENT);
      await prisma.session.update({ where: { id: other.session.id }, data: { revokedAt: new Date() } });
      signalAgendaChanged(business.id);
      assert.equal(await endsWithin(stream), true);
      assert.deepEqual(stream.events, [LIVE_READY_EVENT]);
    });

    await t.test('a removed member gets no further signal and loses the stream', async () => {
      const other = await person('removed', 'MANAGER');
      const stream = await open(baseUrl, business.id, other.token);
      await stream.waitFor(LIVE_READY_EVENT);
      await prisma.membership.deleteMany({ where: { businessId: business.id, identityId: other.identity.id } });
      signalAgendaChanged(business.id);
      assert.equal(await endsWithin(stream), true);
      assert.deepEqual(stream.events, [LIVE_READY_EVENT]);
    });

    await t.test('the stream ends when the session it was opened with expires', async () => {
      const other = await person('expiring', 'OWNER', 2000);
      const stream = await open(baseUrl, business.id, other.token);
      assert.equal(stream.status, 200);
      await stream.waitFor(LIVE_READY_EVENT);
      assert.equal(await endsWithin(stream), true);
    });

    await t.test('limits the streams one identity can hold, and frees the slots again', async () => {
      const streams = await Promise.all(Array.from({ length: MAX_LIVE_STREAMS_PER_IDENTITY }, () => open(baseUrl, business.id, owner.token)));
      await Promise.all(streams.map(stream => stream.waitFor(LIVE_READY_EVENT)));
      assert.equal((await open(baseUrl, business.id, owner.token)).status, 429);
      for (const stream of streams) stream.close();
      await Promise.all(streams.map(stream => stream.ended));
      await quiet();
      const again = await open(baseUrl, business.id, owner.token);
      assert.equal(again.status, 200);
      await again.waitFor(LIVE_READY_EVENT); again.close();
    });

    await t.test('a client that leaves during setup does not keep its slot', async () => {
      const other = await person('leaver', 'OWNER');
      for (let index = 0; index < MAX_LIVE_STREAMS_PER_IDENTITY; index++) {
        let release = () => {};
        holdHandler = new Promise<void>(resolve => { release = resolve; });
        const controller = new AbortController();
        const leaving = fetch(`${baseUrl}/api/provider/agenda/live?businessId=${business.id}`, { headers: { accept: 'text/event-stream', authorization: `Bearer ${other.token}` }, signal: controller.signal }).catch(() => null);
        await quiet(); controller.abort(); await leaving; await quiet();
        holdHandler = null; release(); await quiet();
      }
      const stream = await open(baseUrl, business.id, other.token);
      assert.equal(stream.status, 200);
      await stream.waitFor(LIVE_READY_EVENT); stream.close();
    });

    await t.test('revoking a member ends their stream at once', async () => {
      const other = await person('revoked-member', 'MANAGER');
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: other.identity.id } });
      const stream = await open(baseUrl, business.id, other.token);
      await stream.waitFor(LIVE_READY_EVENT);
      const actor = await authenticate({ headers: { authorization: `Bearer ${owner.token}` } } as never);
      await revokeMember(actor, business.id, membership.id);
      assert.equal(await endsWithin(stream), true);
      assert.deepEqual(stream.events, [LIVE_READY_EVENT]);
    });

    await t.test('losing Redis ends the stream, and a new stream recovers', async () => {
      const stream = await open(baseUrl, business.id, owner.token);
      await stream.waitFor(LIVE_READY_EVENT);
      await redis.connect().catch(() => {});
      // Only this process's subscriber: other work on this Redis server must not lose its connection.
      const clients = String(await redis.client('LIST', 'TYPE', 'pubsub'));
      const subscriberId = clients.split('\n').find(line => line.includes(`name=${LIVE_SUBSCRIBER_NAME} `))?.match(/^id=(\d+)/)?.[1];
      assert.ok(subscriberId);
      await redis.client('KILL', 'ID', subscriberId);
      assert.equal(await endsWithin(stream), true);
      const recovered = await open(baseUrl, business.id, owner.token);
      assert.equal(recovered.status, 200);
      await recovered.waitFor(LIVE_READY_EVENT);
      signalAgendaChanged(business.id);
      await recovered.waitFor(AGENDA_CHANGED_EVENT);
      recovered.close();
    });

    await t.test('a customer stream requires a session and hears only that customer', async () => {
      const url = `${baseUrl}/api/me/appointments/live`;
      assert.equal((await openPath(url)).status, 401);
      const other = await person('other-customer');
      const stream = await openPath(url, outsider.token);
      assert.equal(stream.status, 200);
      await stream.waitFor(LIVE_READY_EVENT);
      publishLiveSignal(personTopic(other.identity.id)); await quiet();
      assert.deepEqual(stream.events, [LIVE_READY_EVENT]);
      publishLiveSignal(personTopic(outsider.identity.id));
      await stream.waitFor(APPOINTMENTS_CHANGED_EVENT);
      assert.equal(stream.body.replaceAll(': heartbeat\n\n', ''), `event: ${LIVE_READY_EVENT}\ndata: {}\n\nevent: ${APPOINTMENTS_CHANGED_EVENT}\ndata: {}\n\n`);
      stream.close();
    });

    await t.test('a customer stream cannot be pointed at someone else', async () => {
      assert.equal((await openPath(`${baseUrl}/api/me/appointments/live?identityId=${owner.identity.id}`, outsider.token)).status, 400);
    });

    await t.test('a revoked session loses its customer stream', async () => {
      const other = await person('revoked-customer');
      const stream = await openPath(`${baseUrl}/api/me/appointments/live`, other.token);
      await stream.waitFor(LIVE_READY_EVENT);
      await prisma.session.update({ where: { id: other.session.id }, data: { revokedAt: new Date() } });
      publishLiveSignal(personTopic(other.identity.id));
      assert.equal(await endsWithin(stream), true);
      assert.deepEqual(stream.events, [LIVE_READY_EVENT]);
    });

    await t.test('committed agenda changes signal the business', async () => {
      const context = await requireBusinessMembership(owner.identity.id, business.id, ['OWNER']);
      const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Live staff', parallelCapacity: 5 } });
      const service = await prisma.service.create({ data: { businessId: business.id, name: 'Live service', durationMinutes: 30 } });
      const session = await authenticate({ headers: { authorization: `Bearer ${owner.token}` } } as never);
      const day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
      const startsAt = new Date(Date.now() + 86400000), endsAt = new Date(+startsAt + 1800000);
      const booking = await prisma.booking.create({ data: { businessId: business.id, customerId: outsider.identity.id, customerName: 'Customer', staffId: staff.id, serviceId: service.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', idempotencyKey: randomUUID() } });
      await expectCustomerSignal(outsider.identity.id, () => expectAgendaSignal(business.id, () => changeBookingOutcome(session, booking.id, 'CANCELLED', business.id)));
      // Repeating a change that changes nothing must not let a customer drive re-reads on the business's open agendas.
      await expectNoAgendaSignal(business.id, () => changeBookingOutcome(session, booking.id, 'CANCELLED', business.id));
      // A change that rolled back is not a change.
      await expectNoAgendaSignal(business.id, () => changingAgenda(context, async () => { throw new Error('rolled back'); }));
      // Booking first: changing a block rechecks publication, and this fixture has no hours to stay published with.
      const block = await expectAgendaSignal(business.id, () => createTimeBlock(context, { staffId: staff.id, kind: 'days', fromDate: day, toDate: day }, session));
      await expectAgendaSignal(business.id, () => deleteTimeBlock(context, (block as { id: string }).id, session));
      const added = await expectAgendaSignal(business.id, () => createBusinessStaff(context, { displayName: 'Added', serviceIds: [service.id] }));
      await expectAgendaSignal(business.id, () => updateBusinessStaff(context, added.id, { displayName: 'Renamed' }));
      const removable = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Removable', parallelCapacity: 1 } });
      await expectAgendaSignal(business.id, () => removeBusinessStaff(context, removable.id, session));
    });

    await t.test('closing the server ends open streams instead of waiting on them', async () => {
      const stream = await open(baseUrl, business.id, owner.token);
      await stream.waitFor(LIVE_READY_EVENT);
      await Promise.race([app.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('The server did not close.')), SHUTDOWN_WAIT_MS))]);
      assert.equal(await endsWithin(stream), true);
    });
  } finally {
    await app.close();
    await prisma.booking.deleteMany({ where: { businessId: { in: [business.id, foreign.id] } } });
    await prisma.businessAccessEvent.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, foreign.id] } } });
    await prisma.identity.deleteMany({ where: { email: { endsWith: `-${key}@example.test` } } });
  }
});

test('through the real app, the stream keeps the private cache rule and the configured origin', async () => {
  const key = randomUUID(), token = randomUUID();
  const business = await prisma.business.create({ data: { slug: `live-app-${key}`, name: 'Live app', approvalStatus: 'APPROVED', timezone: 'Asia/Jerusalem' } });
  const identity = await prisma.identity.create({ data: { email: `live-app-${key}@example.test` } });
  await prisma.membership.create({ data: { businessId: business.id, identityId: identity.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  const app = await createApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/provider/agenda/live?businessId=${business.id}`, controller = new AbortController();
  try {
    const invalid = await fetch(`${url}&extra=1`, { headers: { accept: 'text/event-stream', authorization: `Bearer ${token}` } });
    assert.equal(invalid.status, 400);
    const response = await fetch(url, { headers: { accept: 'text/event-stream', authorization: `Bearer ${token}`, origin: new URL(env.WEB_APP_URL).origin }, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), new URL(env.WEB_APP_URL).origin);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
  } finally {
    controller.abort();
    await app.close();
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.delete({ where: { id: identity.id } });
  }
});

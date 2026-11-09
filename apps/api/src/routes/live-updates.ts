import { fastifySSE } from '@fastify/sse';
import { LIVE_HEARTBEAT_MS, LIVE_READY_EVENT } from '@visit/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { agendaTopic, closeLiveSignals, customerTopic, followLiveSignal } from '../infra/live-signals.js';
import { authenticate, validateAuthenticatedSession, type AuthenticatedSession } from '../security/sessions.js';
import { requireBusinessMembership } from '../security/tenant-context.js';

export const AGENDA_CHANGED_EVENT = 'agenda-changed';
export const APPOINTMENTS_CHANGED_EVENT = 'appointments-changed';
export { LIVE_READY_EVENT };
export const MAX_LIVE_STREAMS_PER_IDENTITY = 6;
/** A burst of changes costs one authorization check and one client re-read. */
export const LIVE_SIGNAL_COALESCE_MS = 250;
/** Also bounds the timer: Node fires a longer-than-32-bit timeout at once. */
export const MAX_LIVE_STREAM_MS = 15 * 60 * 1000;

const AGENDA_ROLES = ['OWNER', 'MANAGER'] as const;
const openStreams = new Map<string, number>();

type LiveStream = { session: AuthenticatedSession; topic: string; event: string; stillAllowed: () => Promise<unknown> };

async function streamLiveSignals(reply: FastifyReply, { session, topic, event, stillAllowed }: LiveStream) {
  const identityId = session.identity.id, sessionExpiresAt = await validateAuthenticatedSession(session);
  const open = openStreams.get(identityId) ?? 0;
  if (open >= MAX_LIVE_STREAMS_PER_IDENTITY) throw new AppError(429, 'TOO_MANY_LIVE_STREAMS', 'Too many live connections are open.');
  openStreams.set(identityId, open + 1);
  let released = false, coalesce: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, stop = () => {};
  const release = () => {
    if (released) return;
    released = true; clearTimeout(coalesce); clearTimeout(deadline); stop();
    const remaining = (openStreams.get(identityId) ?? 1) - 1;
    if (remaining) openStreams.set(identityId, remaining); else openStreams.delete(identityId);
  };
  reply.sse!.onClose(release);
  // A client can leave while the checks above run, and then no close event is left to free this slot.
  const gone = () => !reply.sse!.isConnected || reply.raw.destroyed;
  const end = () => { release(); reply.sse!.close(); };
  // Authorization can change while the stream is open, so it is rechecked before each delivery.
  const deliver = async () => {
    coalesce = undefined;
    try {
      await validateAuthenticatedSession(session); await stillAllowed();
      if (!released) await reply.sse!.send({ event, data: {} });
    } catch { end(); }
  };
  // Set before subscribing: a signal can write the response head as soon as the subscription exists.
  // A stream's socket is never reused: without this, shutdown waits out its keep-alive timeout.
  reply.header('cache-control', 'no-store').header('connection', 'close');
  try {
    if (gone()) { release(); return; }
    const unfollow = await followLiveSignal(topic, () => { if (!released) coalesce ??= setTimeout(() => void deliver(), LIVE_SIGNAL_COALESCE_MS); }, end);
    if (released || gone()) { unfollow(); release(); return; }
    stop = unfollow;
    // The client reconnects with a refreshed session, so this stream never outlives the one it was opened with.
    deadline = setTimeout(end, Math.min(sessionExpiresAt.getTime() - Date.now(), MAX_LIVE_STREAM_MS));
    deadline.unref();
    reply.sse!.keepAlive();
    // Sent after subscribing: anything changed before this point is covered by the re-read it triggers.
    await reply.sse!.send({ event: LIVE_READY_EVENT, data: {} });
  } catch (error) { release(); throw error; }
}

/**
 * Await this before adding any route. Awaiting a plugin registration finishes booting what is queued, which
 * fixes the error handler of the routes added so far: every validation error then answers 500 instead of 400.
 */
export const registerLiveStreaming = (app: FastifyInstance) => app.register(fastifySSE, { heartbeatInterval: LIVE_HEARTBEAT_MS });

export function registerLiveUpdates(app: FastifyInstance) {
  app.addHook('preClose', async () => closeLiveSignals());
  app.get('/api/provider/agenda/live', { sse: 'only' }, async (request, reply) => {
    const { businessId } = z.strictObject({ businessId: z.string().min(1).max(256) }).parse(request.query);
    const session = await authenticate(request);
    const stillAllowed = () => requireBusinessMembership(session.identity.id, businessId, AGENDA_ROLES);
    await stillAllowed();
    await streamLiveSignals(reply, { session, topic: agendaTopic(businessId), event: AGENDA_CHANGED_EVENT, stillAllowed });
  });
  // The topic comes from the session alone, so a customer can only ever follow their own appointments.
  app.get('/api/me/appointments/live', { sse: 'only' }, async (request, reply) => {
    z.strictObject({}).parse(request.query);
    const session = await authenticate(request);
    await streamLiveSignals(reply, { session, topic: customerTopic(session.identity.id), event: APPOINTMENTS_CHANGED_EVENT, stillAllowed: async () => {} });
  });
}

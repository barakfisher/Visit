import { Redis, type RedisOptions } from 'ioredis';
import { prisma } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { MANAGING_ROLES } from '../security/tenant-context.js';
import { redis } from './redis.js';

/**
 * Tells open screens that something changed. A signal carries a topic and nothing else: the screen
 * re-reads through its authorized endpoint, so this channel never holds appointment data.
 * Redis pub/sub reaches every API instance. It keeps no history, so a signal nobody hears is gone.
 */
const CHANNEL_PREFIX = 'visit:live:';
export const LIVE_SUBSCRIBE_TIMEOUT_MS = 3000;
export const LIVE_SUBSCRIBER_NAME = `visit-live-${process.pid}`;

type Follower = { onSignal: () => void; onLost: () => void };
const followers = new Map<string, Set<Follower>>();
let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let subscribed: Promise<unknown> | null = null;

export const agendaTopic = (businessId: string) => `agenda:${businessId}`;
/** One topic per person, for their appointments and their notifications alike: a browser can spare only one stream for this. */
export const personTopic = (identityId: string) => `person:${identityId}`;

function loseEveryFollower() {
  for (const set of [...followers.values()]) for (const follower of [...set]) follower.onLost();
}

// Open sockets here must not hold a process open: shutdown ends them explicitly, and only a listening server should keep running.
function background(options: RedisOptions) {
  const created = redis.duplicate({ lazyConnect: true, enableOfflineQueue: true, ...options });
  created.on('error', () => {});
  created.on('connect', () => (created as unknown as { stream?: { unref?: () => void } }).stream?.unref?.());
  return created;
}

function connection() {
  if (subscriber) return subscriber;
  // A subscribed Redis connection can do nothing else, so this one is separate from the shared client.
  const created = background({ maxRetriesPerRequest: null, connectionName: LIVE_SUBSCRIBER_NAME });
  created.on('pmessage', (_pattern: string, channel: string) => {
    for (const follower of [...followers.get(channel.slice(CHANNEL_PREFIX.length)) ?? []]) follower.onSignal();
  });
  // Signals sent while disconnected are lost for good. Ending the streams makes every client
  // reconnect and re-read once Redis is back, which is what recovers them.
  created.on('close', () => {
    if (subscriber !== created) return;
    console.warn('The live signal subscription was lost.');
    subscribed = null; loseEveryFollower();
  });
  subscriber = created;
  return created;
}

async function ensureSubscribed() {
  const pending = subscribed ??= connection().psubscribe(`${CHANNEL_PREFIX}*`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), LIVE_SUBSCRIBE_TIMEOUT_MS); })]);
  } catch {
    if (subscribed === pending) subscribed = null;
    throw new AppError(503, 'LIVE_UNAVAILABLE', 'Live updates are unavailable. Retry shortly.');
  } finally { clearTimeout(timer); }
}

/** Resolves once signals on this topic will be heard. Returns the function that stops following. */
export async function followLiveSignal(topic: string, onSignal: () => void, onLost: () => void) {
  const follower = { onSignal, onLost };
  const set = followers.get(topic) ?? new Set<Follower>();
  followers.set(topic, set.add(follower));
  const stop = () => { set.delete(follower); if (!set.size && followers.get(topic) === set) followers.delete(topic); };
  try { await ensureSubscribed(); } catch (error) { stop(); throw error; }
  return stop;
}

/** Call only after the change has committed. A failed publish never fails the write it reports. */
export function publishLiveSignal(topic: string) {
  // Separate from the shared client too, whose connection state booking holds depend on.
  publisher ??= background({ maxRetriesPerRequest: 1 });
  publisher.publish(`${CHANNEL_PREFIX}${topic}`, '1').catch(() => {
    console.warn('A live signal could not be published.');
  });
}

export const signalAgendaChanged = (businessId: string) => publishLiveSignal(agendaTopic(businessId));

export const signalPersonChanged = (identityId: string) => publishLiveSignal(personTopic(identityId));

/** Who is told is decided by the booking event's trigger; this only wakes the screens that might show it. A manager who was not notified just re-reads. */
async function signalBusinessManagers(businessId: string) {
  try {
    const managers = await prisma.membership.findMany({ where: { businessId, status: 'ACTIVE', role: { in: [...MANAGING_ROLES] } }, distinct: ['identityId'], select: { identityId: true } });
    for (const { identityId } of managers) signalPersonChanged(identityId);
  } catch { console.warn('The business managers could not be signalled.'); }
}

/** An appointment changed: tells the business's screens and managers and, unless it was entered by hand, the customer. */
export function signalAppointmentChanged({ businessId, customerId }: { businessId: string; customerId: string | null }) {
  signalAgendaChanged(businessId);
  if (customerId) signalPersonChanged(customerId);
  void signalBusinessManagers(businessId);
}

/** Ends every open stream and the subscriber connection, so server shutdown does not wait on them. */
export function closeLiveSignals() {
  const closing = [subscriber, publisher];
  subscriber = null; publisher = null; subscribed = null;
  loseEveryFollower();
  for (const connection of closing) connection?.disconnect();
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, createApiClient } from '../src/lib/apiClient';
import { isCustomerAppointmentQuery } from '../src/lib/BookingQueries.utils';
import { upcomingCardState } from '../src/lib/UpcomingAppointment.utils';
import { followLiveSignals, LIVE_RECONNECT_SPREAD_MS, LIVE_RETRY_BASE_MS, LIVE_RETRY_MAX_MS, shareLiveSignals, watchForegroundReturn } from '../src/lib/LiveSignals.service';

const encoder = new TextEncoder();
const ready = 'event: ready\ndata: {}\n\n', changed = 'event: agenda-changed\ndata: {}\n\n';
/** A stream that delivers these chunks and ends. */
const stream = (...chunks: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } });
/** A stream that stays open and silent until its connection is aborted. */
const silent = (signal: AbortSignal) => new ReadableStream<Uint8Array>({ start(controller) { signal.addEventListener('abort', () => controller.error(new Error('aborted'))); } });

function harness(connections: ((signal: AbortSignal) => { body: ReadableStream<Uint8Array> | null })[]) {
  const controller = new AbortController(), waits: number[] = [];
  let changes = 0, opened = 0;
  const run = followLiveSignals({
    open: async signal => {
      const next = connections[opened++];
      if (!next) { controller.abort(); return { body: stream() }; }
      return next(signal);
    },
    onChange: () => { changes += 1; },
    signal: controller.signal,
    wait: async ms => { waits.push(ms); },
    random: () => 1,
    silenceLimitMs: 20,
  });
  return { run, waits, changes: () => changes, opened: () => opened, controller };
}
const fail = (error: unknown) => () => { throw error; };

test('a connection re-reads when it opens and on each signal', async () => {
  const { run, changes } = harness([() => ({ body: stream(ready, changed, changed) })]);
  await run;
  assert.equal(changes(), 3);
});

test('a signal split across network chunks still counts once', async () => {
  const { run, changes } = harness([() => ({ body: stream('event: agenda-', 'changed\nda', 'ta: {}\n\n') })]);
  await run;
  assert.equal(changes(), 1);
});

test('heartbeats do not re-read', async () => {
  const { run, changes } = harness([() => ({ body: stream(ready, ': heartbeat\n\n', ': heartbeat\n\n') })]);
  await run;
  assert.equal(changes(), 1);
});

test('heartbeats keep a stream open past the silence limit', async () => {
  const SILENCE_MS = 200, BEAT_MS = 80, BEATS = 4;
  const controller = new AbortController(), waits: number[] = [];
  let opened = 0;
  await followLiveSignals({
    open: async signal => {
      opened += 1;
      if (opened > 1) { controller.abort(); return { body: stream() }; }
      return { body: new ReadableStream<Uint8Array>({ start(body) {
        signal.addEventListener('abort', () => { clearInterval(timer); body.error(new Error('aborted')); });
        let beats = 0;
        const timer = setInterval(() => { body.enqueue(encoder.encode(': heartbeat\n\n')); if (++beats === BEATS) { clearInterval(timer); body.close(); } }, BEAT_MS);
      } }) };
    },
    onChange: () => {}, signal: controller.signal, silenceLimitMs: SILENCE_MS, random: () => 1, wait: async ms => { waits.push(ms); },
  });
  // Only a clean end waits out the spread. The watchdog cutting it short would have counted as a failure.
  assert.deepEqual(waits, [LIVE_RECONNECT_SPREAD_MS]);
});

test('a stream the server ends is reopened and re-read, spread out so windows do not refresh together', async () => {
  const { run, changes, opened, waits } = harness([() => ({ body: stream(ready) }), () => ({ body: stream(ready) })]);
  await run;
  assert.equal(opened(), 3); assert.equal(changes(), 2);
  assert.deepEqual(waits.slice(0, 2), [LIVE_RECONNECT_SPREAD_MS, LIVE_RECONNECT_SPREAD_MS]);
});

test('a session change stops retrying, and the attempt aborts its connection', async () => {
  const seen: AbortSignal[] = [];
  const { run, opened, waits } = harness([signal => { seen.push(signal); throw new ApiError('changed', 'SESSION_CHANGED', 0); }, () => ({ body: stream(ready) })]);
  await run;
  assert.equal(seen[0]!.aborted, true);
  assert.equal(opened(), 1); assert.deepEqual(waits, []);
});

test('failures back off up to the ceiling, and a healthy connection resets them', async () => {
  const outage = fail(new ApiError('down', 'NETWORK_ERROR', 0));
  let pulls = 0;
  const steps = Math.ceil(Math.log2(LIVE_RETRY_MAX_MS / LIVE_RETRY_BASE_MS)) + 2;
  const breaksAfterReady = () => ({ body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(ready)); }, pull(controller) { if (controller.desiredSize !== null && pulls++) controller.error(new Error('reset')); } }) });
  const { run, waits } = harness([...Array.from({ length: steps }, () => outage), breaksAfterReady]);
  await run;
  const expected = Array.from({ length: steps }, (_, index) => Math.min(LIVE_RETRY_MAX_MS, LIVE_RETRY_BASE_MS * 2 ** index));
  assert.deepEqual(waits.slice(0, steps), expected);
  assert.equal(waits[steps], LIVE_RETRY_BASE_MS);
});

test('a stream that goes silent is replaced', async () => {
  const { run, opened, changes } = harness([signal => ({ body: silent(signal) }), () => ({ body: stream(ready) })]);
  await run;
  assert.equal(opened(), 3); assert.equal(changes(), 1);
});

for (const status of [400, 401, 403, 404]) {
  test(`a ${status} stops retrying`, async () => {
    const { run, opened, waits } = harness([fail(new ApiError('refused', 'REFUSED', status)), () => ({ body: stream(ready) })]);
    await run;
    assert.equal(opened(), 1); assert.deepEqual(waits, []);
  });
}

test('aborting stops an open stream without another connection', async () => {
  const controller = new AbortController();
  let opened = 0;
  const run = followLiveSignals({ open: async signal => { opened += 1; queueMicrotask(() => controller.abort()); return { body: silent(signal) }; }, onChange: () => {}, signal: controller.signal, silenceLimitMs: 60000 });
  await run;
  assert.equal(opened, 1);
});

/** One browser: an exclusive lock with a queue, and a channel that delivers later and does not echo to its sender. */
function browser() {
  let held = false; const queue: (() => void)[] = [], channels = new Set<{ onmessage: ((event: MessageEvent) => void) | null; postMessage: (message: unknown) => void; close: () => void }>();
  const release = () => { const next = queue.shift(); if (next) next(); else held = false; };
  const request = async (_name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
    // As the Web Locks standard requires of a real browser.
    if (options.ifAvailable && options.signal) throw new DOMException('not supported', 'NotSupportedError');
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (held && options.ifAvailable) return callback(null);
    if (held) await new Promise<void>((resolve, reject) => {
      const take = () => { options.signal?.removeEventListener('abort', leave); resolve(); };
      const leave = () => { queue.splice(queue.indexOf(take), 1); reject(new DOMException('aborted', 'AbortError')); };
      queue.push(take); options.signal?.addEventListener('abort', leave);
    });
    held = true;
    try { return await callback({} as Lock); } finally { release(); }
  };
  const openChannel = () => {
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: () => { for (const other of channels) if (other !== channel) setTimeout(() => other.onmessage?.({} as MessageEvent)); }, close: () => { channels.delete(channel); } };
    channels.add(channel); return channel;
  };
  return { locks: { request: request as LockManager['request'] }, openChannel, listening: () => channels.size };
}

function tab(shared: ReturnType<typeof browser>) {
  const controller = new AbortController();
  let changes = 0, push: (() => void) | undefined, following = false, finish: (() => void) | undefined;
  const run = shareLiveSignals({ name: 'topic', ...shared, onChange: () => { changes += 1; }, signal: controller.signal, follow: (onChange, signal) => new Promise<void>(resolve => {
    following = true; push = onChange; finish = () => { following = false; resolve(); };
    signal.addEventListener('abort', finish);
  }) });
  return { run, close: () => { controller.abort(); return run; }, stopForGood: () => { finish!(); return run; }, changes: () => changes, following: () => following, signalFromServer: () => push!() };
}
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

test('tabs of one browser share one stream, and the signal reaches each of them once', async () => {
  const shared = browser(), first = tab(shared), second = tab(shared), third = tab(shared);
  await settled();
  assert.deepEqual([first.following(), second.following(), third.following()], [true, false, false]);
  first.signalFromServer(); await settled();
  assert.deepEqual([first.changes(), second.changes(), third.changes()], [1, 2, 2]);
  await Promise.all([first.close(), second.close(), third.close()]);
});

test('a tab joining an open stream re-reads what it missed', async () => {
  const shared = browser(), first = tab(shared), second = tab(shared);
  await settled();
  assert.equal(first.changes(), 0); assert.equal(second.changes(), 1);
  await Promise.all([first.close(), second.close()]);
});

test('when the tab holding the stream goes, one waiting tab takes over', async () => {
  const shared = browser(), first = tab(shared), second = tab(shared), third = tab(shared);
  await settled();
  await first.close(); await settled();
  assert.deepEqual([second.following(), third.following()], [true, false]);
  await Promise.all([second.close(), third.close()]);
});

test('the tab that takes over relays to the others', async () => {
  const shared = browser(), first = tab(shared), second = tab(shared), third = tab(shared);
  await settled();
  await first.close(); await settled();
  const before = third.changes();
  second.signalFromServer(); await settled();
  assert.equal(third.changes(), before + 1);
  await Promise.all([second.close(), third.close()]);
});

test('a tab that stops for good passes the lock on', async () => {
  const shared = browser(), first = tab(shared), second = tab(shared);
  await settled();
  await first.stopForGood(); await settled();
  assert.equal(second.following(), true);
  await second.close();
});

test('a browser that refuses the lock still gets a stream, unless the tab already left', async () => {
  const shared = browser(), refuse = { request: (async () => { throw new DOMException('blocked', 'SecurityError'); }) as LockManager['request'] };
  let followed = 0;
  await shareLiveSignals({ name: 'topic', locks: refuse, openChannel: shared.openChannel, onChange: () => {}, signal: new AbortController().signal, follow: async () => { followed += 1; } });
  assert.equal(followed, 1);
  assert.equal(shared.listening(), 0);
  const left = new AbortController(); left.abort();
  await shareLiveSignals({ name: 'topic', locks: refuse, openChannel: shared.openChannel, onChange: () => {}, signal: left.signal, follow: async () => { followed += 1; } });
  assert.equal(followed, 1);
});

test('returning to the foreground re-reads once, and only on a return', () => {
  let returns = 0;
  const seen = watchForegroundReturn('active', () => { returns += 1; });
  seen('active');
  assert.equal(returns, 0);
  seen('background'); seen('inactive');
  assert.equal(returns, 0);
  seen('active'); seen('active');
  assert.equal(returns, 1);
});

test('a waiting tab that leaves stops listening and never opens a stream', async () => {
  const shared = browser(), first = tab(shared), second = tab(shared);
  await settled();
  await second.close();
  assert.equal(second.following(), false); assert.equal(shared.listening(), 1);
  await first.close();
  assert.equal(shared.listening(), 0);
});

test('without locks or a channel, as on native, the app holds its own stream', async () => {
  const shared = browser();
  for (const missing of [{ locks: null, openChannel: shared.openChannel }, { locks: shared.locks, openChannel: null }]) {
    let followed = 0;
    await shareLiveSignals({ name: 'topic', onChange: () => {}, signal: new AbortController().signal, follow: async () => { followed += 1; }, ...missing });
    assert.equal(followed, 1);
  }
});

function client(responses: Response[], overrides: { onProviderForbidden?: () => void; native?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [], plainCalls: string[] = [];
  let token: string | null = 'first';
  const request = createApiClient({
    baseUrl: 'https://api.example.test', native: overrides.native ?? true, readToken: async () => token, saveToken: async value => { token = value; }, clearSession: () => {}, contextVersion: () => 1,
    onProviderForbidden: overrides.onProviderForbidden,
    fetch: (async (input: RequestInfo | URL) => { plainCalls.push(String(input)); return new Response(JSON.stringify({ sessionToken: 'second' }), { status: 200 }); }) as typeof fetch,
    streamingFetch: (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return responses.shift()!; }) as typeof fetch,
  });
  return { request, calls, plainCalls };
}
const path = '/api/provider/agenda/live?businessId=one', signal = new AbortController().signal;

test('a stream asks for events with the session token through the streaming fetch', async () => {
  const { request, calls, plainCalls } = client([new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })]);
  await request.openStream(path, signal);
  const headers = calls[0]!.init!.headers as Headers;
  assert.equal(headers.get('accept'), 'text/event-stream'); assert.equal(headers.get('authorization'), 'Bearer first'); assert.equal(headers.get('x-visit-client'), 'native');
  assert.equal(plainCalls.length, 0);
});

test('a 200 that is not a stream is a failure to back off from, not a clean end', async () => {
  const { request } = client([new Response('<html>Sign in to this Wi-Fi</html>', { status: 200, headers: { 'content-type': 'text/html' } })]);
  await assert.rejects(request.openStream(path, signal), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
});

test('an expired session refreshes once and reconnects with the new token', async () => {
  const { request, calls, plainCalls } = client([new Response('{}', { status: 401 }), new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })]);
  const response = await request.openStream(path, signal);
  assert.equal(response.status, 200); assert.equal(plainCalls.length, 1);
  assert.equal((calls[1]!.init!.headers as Headers).get('authorization'), 'Bearer second');
});

test('lost provider access reports through the same hook as other provider requests', async () => {
  let forbidden = 0;
  const { request } = client([new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 })], { onProviderForbidden: () => { forbidden += 1; } });
  await assert.rejects(request.openStream(path, signal), (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === 'FORBIDDEN');
  assert.equal(forbidden, 1);
});

test('a customer signal re-reads appointments, not the profile or the provider workspace', () => {
  for (const key of [['me', 'upcoming', 'id', 1, 'all'], ['me', 'bookings', 'id', 1], ['consumer', 'active', 'id', 1], ['booking-details', 'id', 1, 'b'], ['appointment-history', 'id', 1, 'customer', 'b', 0]]) assert.equal(isCustomerAppointmentQuery(key), true, String(key));
  for (const key of [['me', 'id'], ['provider', 'b', 'agenda'], ['availability', 'id']]) assert.equal(isCustomerAppointmentQuery(key), false, String(key));
});

test('the upcoming card stays on screen during a re-read and gives feedback on a retry', () => {
  const read = { visible: true, isPending: false, isError: false, isFetching: false, hasBooking: true };
  assert.equal(upcomingCardState(read), 'ready');
  assert.equal(upcomingCardState({ ...read, isFetching: true }), 'ready');
  assert.equal(upcomingCardState({ ...read, isPending: true, isFetching: true, hasBooking: false }), 'loading');
  assert.equal(upcomingCardState({ ...read, isError: true }), 'error');
  assert.equal(upcomingCardState({ ...read, isError: true, isFetching: true }), 'loading');
  assert.equal(upcomingCardState({ ...read, hasBooking: false }), 'hidden');
  assert.equal(upcomingCardState({ ...read, isFetching: true, hasBooking: false }), 'hidden');
  assert.equal(upcomingCardState({ ...read, visible: false, isPending: true }), 'hidden');
});

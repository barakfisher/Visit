import { LIVE_READY_EVENT, LIVE_SILENCE_LIMIT_MS } from '@visit/contracts';
import { createParser } from 'eventsource-parser';
import { ApiError } from './apiClient';

export const LIVE_RETRY_BASE_MS = 1000;
export const LIVE_RETRY_MAX_MS = 30000;
/**
 * A stream the server ended reconnects anywhere within this window. Streams of one session end together when
 * it expires, and a refresh token replayed by a second window at the same moment logs the user out
 * (session-security.md). What happens during the wait is covered by the re-read on reconnecting.
 */
export const LIVE_RECONNECT_SPREAD_MS = 20000;

type Follow = {
  open: (signal: AbortSignal) => Promise<{ body: ReadableStream<Uint8Array> | null }>;
  /** Called when the data may have changed: on every connection and on every signal. */
  onChange: () => void;
  signal: AbortSignal;
  silenceLimitMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
};

const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', done);
});

/** Retrying cannot fix these: the session or the access is gone until something else changes. */
const isFinal = (error: unknown) => error instanceof ApiError && ([400, 401, 403, 404].includes(error.status) || error.code === 'SESSION_CHANGED');

/**
 * Keeps one stream open until the signal aborts. There is no polling behind it, so a connection is
 * the only way to hear a change: each new one re-reads to catch what was missed, and a stream that
 * goes silent past its heartbeats (a phone changing networks never sees a close) is replaced.
 */
export async function followLiveSignals({ open, onChange, signal, silenceLimitMs = LIVE_SILENCE_LIMIT_MS, wait = pause, random = Math.random }: Follow) {
  let failures = 0;
  while (!signal.aborted) {
    const connection = new AbortController();
    const abort = () => connection.abort();
    signal.addEventListener('abort', abort);
    let watchdog: ReturnType<typeof setTimeout> | undefined, endedCleanly = false;
    const heard = () => { clearTimeout(watchdog); watchdog = setTimeout(abort, silenceLimitMs); };
    try {
      heard();
      const { body } = await open(connection.signal);
      if (!body) throw new Error('The live stream has no body.');
      const parser = createParser({ onEvent: event => {
        if (event.event === LIVE_READY_EVENT) failures = 0;
        onChange();
      } });
      const reader = body.getReader(), decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { endedCleanly = true; break; }
          heard();
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } finally { void reader.cancel().catch(() => {}); }
    } catch (error) {
      if (isFinal(error)) return;
    } finally {
      clearTimeout(watchdog);
      signal.removeEventListener('abort', abort);
      // Whatever ended this attempt, its connection must not stay open behind the next one.
      connection.abort();
    }
    if (signal.aborted) return;
    if (endedCleanly) { await wait(LIVE_RECONNECT_SPREAD_MS * random(), signal); continue; }
    failures += 1;
    const ceiling = Math.min(LIVE_RETRY_MAX_MS, LIVE_RETRY_BASE_MS * 2 ** (failures - 1));
    // The jitter stops every client reconnecting at the same moment after a server restart.
    await wait(ceiling * (0.5 + random() * 0.5), signal);
  }
}

type Share = {
  /** Scopes the shared stream: one identity's one topic. */
  name: string;
  follow: (onChange: () => void, signal: AbortSignal) => Promise<void>;
  onChange: () => void;
  signal: AbortSignal;
  locks?: Pick<LockManager, 'request'> | null;
  openChannel?: ((name: string) => Pick<BroadcastChannel, 'onmessage' | 'postMessage' | 'close'>) | null;
};

const browserLocks = () => globalThis.navigator?.locks;
const browserChannel = (name: string) => new BroadcastChannel(name);

/**
 * Over HTTP/1.1 a browser allows six connections to one host, and a stream keeps one for as long as it is open.
 * With one stream per tab, six visible tabs left ordinary requests waiting forever, with no error.
 * So one tab per browser holds the lock and the stream, and tells the others. A tab that hides stops following
 * and lets go; the browser frees the lock of one that closes or crashes; a waiting tab then takes over. Native
 * apps have one window, and neither API. A browser that refuses the lock still gets a stream of its own.
 */
export async function shareLiveSignals({ name, follow, onChange, signal, locks = browserLocks(), openChannel = typeof BroadcastChannel === 'undefined' ? undefined : browserChannel }: Share) {
  if (!locks || !openChannel) { await follow(onChange, signal); return; }
  const channel = openChannel(name);
  channel.onmessage = () => onChange();
  const lead = () => follow(() => { onChange(); channel.postMessage(null); }, signal);
  try {
    const led = await locks.request(name, { ifAvailable: true }, async lock => { if (!lock) return false; await lead(); return true; });
    if (led || signal.aborted) return;
    // Joining an open stream has no connection to catch up with, so what this tab missed is read here.
    onChange();
    await locks.request(name, { signal }, lead);
  } catch {
    if (!signal.aborted) await follow(onChange, signal);
  } finally { channel.close(); }
}

/**
 * Calls back when the app returns to the foreground. The re-read must not wait for the stream: on native nothing
 * else re-reads on return, and a stream that cannot connect would leave a stale screen although reads still work.
 */
export function watchForegroundReturn(initial: string | null | undefined, onReturn: () => void) {
  let last = initial;
  return (state: string) => { if (state === 'active' && last !== 'active') onReturn(); last = state; };
}

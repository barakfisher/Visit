import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, createApiClient } from '../src/lib/apiClient';
import { queryClient } from '../src/lib/queryClient';
import { useSessionStore } from '../src/state/session';

function fixture(transport: typeof fetch, native = false) {
  let token: string | null = 'initial', version = 0, clears = 0;
  const request = createApiClient({ baseUrl: 'https://api.example.test', native, fetch: transport, readToken: async () => token, saveToken: async value => { token = value; }, clearSession: () => { clears++; version++; }, contextVersion: () => version, timeoutMs: 50 });
  return { request, change: () => version++, state: () => ({ token, clears }) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('API transport uses typed JSON, normalized headers, credentials and no-store', async () => {
  const f = fixture(async (url, init) => {
    assert.equal(String(url), 'https://api.example.test/api/provider/agenda?businessId=a');
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'include');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Visit-Client'), 'native'); assert.equal(headers.get('Authorization'), 'Bearer initial');
    assert.equal(headers.get('X-Custom'), 'test');
    return json({ id: 'a' });
  }, true);
  assert.deepEqual(await f.request('/api/provider/agenda?businessId=a', { headers: new Headers({ 'X-Custom': 'test' }) }), { id: 'a' });
});
test('API transport rejects cross-origin URLs before transmitting credentials', async () => {
  const f = fixture(async () => { assert.fail('must not fetch'); });
  for (const path of ['https://attacker.test', '//attacker.test', '/\\attacker.test']) await assert.rejects(f.request(path), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PATH');
});
test('structured API errors preserve field errors and forbidden does not sign out', async () => {
  const f = fixture(async () => json({ error: { code: 'FORBIDDEN', message: 'Access denied', fields: { businessId: 'invalid' } } }, 403));
  await assert.rejects(f.request('/api/provider/agenda'), (error: unknown) => error instanceof ApiError && error.status === 403 && error.fields?.businessId === 'invalid');
  assert.deepEqual(f.state(), { token: 'initial', clears: 0 });
});
test('concurrent unauthorized requests share one refresh and replay once', async () => {
  let refreshes = 0;
  const f = fixture(async (url, init) => {
    if (String(url).endsWith('/v1/auth/refresh')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return json({ sessionToken: 'rotated' }); }
    return new Headers(init?.headers).get('Authorization') === 'Bearer rotated' ? json({ ok: true }) : json({}, 401);
  });
  assert.deepEqual(await Promise.all([f.request('/v1/me'), f.request('/api/auth/me')]), [{ ok: true }, { ok: true }]);
  assert.equal(refreshes, 1); assert.equal(f.state().token, 'rotated');
});
test('refresh outage preserves session and reports outage instead of unauthorized', async () => {
  const f = fixture(async url => String(url).endsWith('/refresh') ? json({ error: { code: 'UNAVAILABLE' } }, 503) : json({}, 401));
  await assert.rejects(f.request('/v1/me'), (error: unknown) => error instanceof ApiError && error.status === 503);
  assert.deepEqual(f.state(), { token: 'initial', clears: 0 });
});
test('confirmed refresh expiry clears session once; auth endpoints do not refresh', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return json({}, 401); });
  await assert.rejects(f.request('/v1/me'), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(calls, 2); assert.deepEqual(f.state(), { token: null, clears: 1 });
  calls = 0;
  await assert.rejects(f.request('/api/auth/otp/verify'), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(calls, 1);
});
test('late response after workspace change is discarded', async () => {
  let release: (() => void) | undefined;
  const f = fixture(async () => { await new Promise<void>(resolve => { release = resolve; }); return json({ private: 'old business' }); });
  const result = f.request('/api/provider/agenda');
  await new Promise(resolve => setTimeout(resolve, 0));
  f.change(); release!();
  await assert.rejects(result, (error: unknown) => error instanceof ApiError && error.code === 'SESSION_CHANGED');
});
test('network, interruption, malformed JSON and empty success are handled consistently', async () => {
  await assert.rejects(fixture(async () => { throw new Error('offline'); }).request('/v1/me'), (error: unknown) => error instanceof ApiError && error.code === 'NETWORK_ERROR');
  const controller = new AbortController(); controller.abort();
  const f = fixture(async (_url, init) => { if (init?.signal?.aborted) throw new Error('aborted'); return json({}); });
  await assert.rejects(f.request('/v1/me', { signal: controller.signal }), (error: unknown) => error instanceof ApiError && error.code === 'REQUEST_ABORTED');
  await assert.rejects(fixture(async () => new Response('bad')).request('/v1/me'), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  assert.equal(await fixture(async () => new Response(null, { status: 204 })).request('/v1/me'), undefined);
});
test('request deadline aborts a stalled transport', async () => {
  const f = fixture(async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
  await assert.rejects(f.request('/v1/me'), (error: unknown) => error instanceof ApiError && error.code === 'REQUEST_ABORTED');
});
test('identity, tenant switch and logout clear all private query prefixes and mutations', async () => {
  const store = useSessionStore;
  const profile = { id: 'owner', email: null, phone: null, is_provider: true, businesses: ['a', 'b'].map(id => ({ id, name: id, timezone: 'UTC' })) };
  store.getState().clear(); store.getState().setAuth(null, profile); store.getState().selectBusiness('a');
  const version = store.getState().contextVersion;
  queryClient.setQueryData(['provider', 'a', 'agenda'], { private: true });
  queryClient.setQueryData(['business', 'a', 'hours'], { private: true });
  queryClient.setQueryData(['consumer', 'bookings'], { private: true });
  queryClient.getMutationCache().build(queryClient, { mutationKey: ['provider', 'a'], gcTime: 0, mutationFn: async () => ({}) });
  let finish: (() => void) | undefined;
  const pending = queryClient.fetchQuery({ queryKey: ['provider', 'a', 'slow'], gcTime: 0, queryFn: async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'late private data'; } }).catch(() => undefined);
  store.getState().selectBusiness('b'); finish!(); await pending;
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
  assert.equal(queryClient.getMutationCache().getAll().length, 0);
  assert.equal(store.getState().activeBusinessId, 'b'); assert.ok(store.getState().contextVersion > version);
  assert.throws(() => store.getState().selectBusiness('foreign'));
  queryClient.setQueryData(['provider', 'b'], 'private');
  store.getState().setAuth(null, { ...profile, businesses: [profile.businesses[0]!] });
  assert.equal(store.getState().activeBusinessId, null);
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
  store.getState().selectBusiness('a');
  store.getState().setAuth(null, { ...profile, id: 'other' });
  assert.equal(store.getState().activeBusinessId, null); assert.equal(queryClient.getQueryCache().getAll().length, 0);
  queryClient.setQueryData(['private'], 'private'); store.getState().clear();
  assert.equal(queryClient.getQueryCache().getAll().length, 0); assert.equal(store.getState().profile, null);
});

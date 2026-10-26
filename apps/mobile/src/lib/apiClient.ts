/** Platform-independent transport. Native secure storage is injected by api.ts. */
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly fields?: Record<string, string>) {
    super(message); this.name = 'ApiError';
  }
}

type Dependencies = {
  baseUrl: string;
  native: boolean;
  readToken: () => Promise<string | null>;
  saveToken: (token: string | null) => Promise<void>;
  clearSession: () => void;
  contextVersion: () => number;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onProviderForbidden?: () => void;
};

export function createApiClient(dependencies: Dependencies) {
  const { baseUrl, native, readToken, saveToken, clearSession, contextVersion, timeoutMs = 15000 } = dependencies;
  const origin = new URL(baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid public API URL.');
  const transport = dependencies.fetch ?? globalThis.fetch;
  let refreshing: { version: number; promise: Promise<boolean> } | null = null;
  const assertContext = (version: number) => {
    if (contextVersion() !== version) throw new ApiError('The account or business changed. Retry in the current workspace.', 'SESSION_CHANGED', 0);
  };
  async function send(path: string, init: RequestInit | undefined, version: number) {
    const url = new URL(path, origin);
    if (!path.startsWith('/') || path.startsWith('//') || url.origin !== origin.origin) throw new ApiError('Invalid API request path.', 'INVALID_PATH', 0);
    const token = await readToken(); assertContext(version);
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    if (native) headers.set('X-Visit-Client', 'native');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init?.signal?.aborted) abort();
    init?.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await transport(url, { ...init, headers, credentials: 'include', cache: 'no-store', signal: controller.signal });
      assertContext(version);
      // Consume under the same deadline; a stalled JSON body must not hang forever.
      const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => null);
      if (controller.signal.aborted) throw new Error('aborted');
      assertContext(version);
      return { response, body };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 'The request was interrupted. Please retry.' : 'The service could not be reached. Check your connection and retry.', controller.signal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR', 0);
    } finally {
      clearTimeout(timer); init?.signal?.removeEventListener('abort', abort);
    }
  }
  function responseError(response: Response, body: unknown) {
    const error = (body as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    return new ApiError(error?.message ?? 'The request could not be completed.', error?.code ?? 'REQUEST_FAILED', response.status, error?.fields);
  }
  async function refresh(version: number) {
    if (refreshing?.version === version) return refreshing.promise;
    const promise = (async () => {
      const { response, body } = await send('/v1/auth/refresh', { method: 'POST' }, version);
      if (!response.ok) {
        // An outage/403 must not destroy a valid identity or its device token.
        if (response.status !== 401) throw responseError(response, body);
        await saveToken(null); assertContext(version); clearSession(); return false;
      }
      const token = (body as { sessionToken?: string } | null)?.sessionToken;
      if (token) { assertContext(version); await saveToken(token); }
      return true;
    })();
    refreshing = { version, promise };
    try { return await promise; }
    finally { if (refreshing?.promise === promise) refreshing = null; }
  }
  return async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const version = contextVersion();
    let { response, body } = await send(path, init, version);
    const authenticating = (path.startsWith('/v1/auth/') || path.startsWith('/api/auth/')) && path !== '/api/auth/me';
    if (response.status === 401 && !authenticating && await refresh(version)) {
      ({ response, body } = await send(path, init, version));
    }
    if (!response.ok) {
      if (response.status === 403 && (path.startsWith('/api/provider/') || path.startsWith('/v1/provider/businesses/'))) dependencies.onProviderForbidden?.();
      throw responseError(response, body);
    }
    if (body === null) throw new ApiError('The service returned an invalid response.', 'INVALID_RESPONSE', 502);
    return body as T;
  };
}

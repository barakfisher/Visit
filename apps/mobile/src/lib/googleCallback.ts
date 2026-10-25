export type GoogleReceipt = { grant: string; verifier?: string; returnTo?: string } | { status: 'cancelled' | 'failed' | 'invalid' };
export type GoogleStart = { intent?: 'login' | 'link'; returnTo?: string };
const opaque = /^[A-Za-z0-9_-]{43}$/;

/** Exact endpoint and fragment grammar; never accept credentials from query parameters. */
export function parseGoogleCallback(value: string, expected: string, clientState?: string): GoogleReceipt {
  try {
    const url = new URL(value), target = new URL(expected);
    if (url.protocol !== target.protocol || url.host !== target.host || url.pathname !== target.pathname || url.username || url.password || url.search || target.search || target.hash) return { status: 'invalid' };
    const params = new URLSearchParams(url.hash.slice(1));
    const allowed = new Set(['grant', 'status', ...(clientState ? ['state'] : [])]);
    if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) return { status: 'invalid' };
    if (clientState && (!opaque.test(clientState) || params.get('state') !== clientState)) return { status: 'invalid' };
    const grant = params.get('grant'), status = params.get('status');
    if (grant && opaque.test(grant) && !status) return { grant };
    if (!grant && (status === 'cancelled' || status === 'failed')) return { status };
  } catch { /* Malformed links never authenticate. */ }
  return { status: 'invalid' };
}
export function safeGoogleReturnTo(value?: string): string | undefined {
  if (!value || /[\\\s#]/.test(value)) return undefined;
  try {
    const url = new URL(value, 'https://visit.invalid');
    if (url.origin !== 'https://visit.invalid' || value[0] !== '/' || value.startsWith('//')) return undefined;
    return url.pathname === '/discover' || /^\/booking\/[A-Za-z0-9-]+$/.test(url.pathname) ? `${url.pathname}${url.search}` : undefined;
  } catch { return undefined; }
}
export function googleAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256' || !opaque.test(url.searchParams.get('code_challenge') ?? '') || !opaque.test(url.searchParams.get('state') ?? '') || !opaque.test(url.searchParams.get('nonce') ?? '')) throw new Error('Invalid Google authorization destination');
  return url.href;
}
export function googleNativeLaunchUrl(value: string, apiOrigin: string): string {
  const url = new URL(value);
  if (url.origin !== new URL(apiOrigin).origin || url.pathname !== '/api/auth/google/authorize' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'ticket') || url.searchParams.getAll('ticket').length !== 1 || !opaque.test(url.searchParams.get('ticket') ?? '')) throw new Error('Invalid Google browser launch');
  return url.href;
}

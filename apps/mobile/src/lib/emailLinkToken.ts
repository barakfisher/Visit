/** Fragment credentials never need to reach the web server or another origin. */
export function emailTokenFromUrl(raw: string, webOrigin?: string): string | null {
  try {
    const url = new URL(raw);
    const native = url.protocol === 'visit:' && url.hostname === 'auth' && url.pathname === '/email';
    const web = Boolean(webOrigin && ['https:', 'http:'].includes(url.protocol) && url.origin === new URL(webOrigin).origin && ['/auth', '/auth/email'].includes(url.pathname));
    if ((!native && !web) || url.username || url.password) return null;
    const tokens = [...url.searchParams.getAll('token'), ...new URLSearchParams(url.hash.slice(1)).getAll('token')];
    return tokens.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(tokens[0]!) ? tokens[0]! : null;
  } catch { return null; }
}
export function withoutEmailToken(raw: string) {
  const url = new URL(raw);
  url.searchParams.delete('token');
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has('token')) { fragment.delete('token'); url.hash = fragment.toString(); }
  return url.toString();
}

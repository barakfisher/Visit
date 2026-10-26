export function invitationToken(raw: string, origin?: string): string | null {
  try {
    const url = new URL(raw);
    const native = url.protocol === 'visit:' && url.hostname === 'invite' && !url.pathname;
    const web = !!origin && url.origin === new URL(origin).origin && url.pathname === '/invite' && ['https:', 'http:'].includes(url.protocol);
    if ((!native && !web) || url.username || url.password || url.search) return null;
    const values = new URLSearchParams(url.hash.slice(1)).getAll('invite');
    return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]!) ? values[0]! : null;
  } catch { return null; }
}

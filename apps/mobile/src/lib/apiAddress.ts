/** Where the API is when nothing is configured: the local development API. */
export const DEFAULT_API_URL = 'http://localhost:3000';

/**
 * The API address for this build. A phone and a browser on the same computer need different ones: the phone
 * reaches the API through an address on the network (a LAN or Tailscale host), while the browser page on
 * localhost must call localhost, or the session cookie the API sets on the other host never comes back to it
 * and sign-in fails after it succeeds. So web reads `EXPO_PUBLIC_WEB_API_URL` first, and falls back to the
 * shared `EXPO_PUBLIC_API_URL` (decisions.md, "One Metro for the phone and the browser" — 2026-11-11).
 */
export function apiAddress(platform: string, env: { api?: string | undefined; web?: string | undefined }) {
  return (platform === 'web' ? env.web || env.api : env.api) || DEFAULT_API_URL;
}

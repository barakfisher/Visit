# Session and request security (VIS-23)

## Credentials and lifetimes

Sessions are opaque cryptographic random tokens. PostgreSQL stores only SHA-256 digests. New access windows last 15 minutes; the absolute refresh window is 30 days. Rotation replaces the token, carries the same family ID, original authentication time and absolute refresh deadline, and never extends that deadline. An expired access token can refresh before the absolute deadline, but cannot access protected data until rotated. Legacy rows preserve their previous absolute expiry during migration; their next rotation adopts the short access window.

Web credentials use host-only HttpOnly cookies with Path=/ and SameSite=Lax. Production requires an HTTPS web origin and uses the Secure `__Host-visit_session` cookie; development uses `visit_session`. Cookie lifetime follows the remaining refresh window. Web responses do not expose credentials in JSON, including when browser JavaScript supplies the native-client header. Browser JS stores no session credential in localStorage/sessionStorage.

Native callers without browser Origin/cookies/fetch metadata may receive the opaque token in JSON. `sessionToken.ts` persists it through Expo SecureStore; ordinary app storage is reserved for language preferences. Zustand holds in-memory profile/UI state. No native keystore/device execution is claimed here; VIS-43 owns device authentication/storage validation.

## Rotation, replay and logout

A PostgreSQL transaction-scoped advisory lock serializes rotation, logout and replay decisions per family. The lock query casts PostgreSQL's void return to text for Prisma's result decoder. Reuse commits revocation of the family's active descendants before returning 401; throwing within that transaction would roll back the protection. Concurrent refresh submissions therefore produce one replacement, then revoke that replacement when reuse is detected. There is deliberately no replay grace window; independent tabs refreshing the same token simultaneously can require a new login. The client shares refresh work within each app instance.

Other login families for the same identity survive replay/logout. Existing rows are conservatively grouped per identity during migration, preserving the former broad replay behavior; new logins receive distinct families. Logout revokes the family server-side before clearing client credentials and private Query state. An already unauthorized logout can clear stale local credentials. Network/server failure preserves local state and shows a retry message rather than falsely claiming logout succeeded.

Refresh does not count as recent authentication. The original `authenticatedAt` is preserved for explicit linking/contact-change policies in VIS-15/VIS-37.

## CSRF and trusted proxies

A global onRequest hook checks every unsafe request. Browser Origin must exactly match the configured web origin; null, foreign and lookalike origins are rejected even with a native header or bearer token. Cookie-authenticated writes without Origin are rejected. Origin-less nonbrowser clients require an explicit bearer/native header or JSON content type and cannot carry ambient session cookies or browser fetch metadata. GET/HEAD/OPTIONS remain read-only. Compatibility routes preserve Origin/fetch metadata when invoking the authoritative handler. CORS uses the same configured origin; it is not the only CSRF defense.

Forwarded addresses are ignored by default. `TRUSTED_PROXY_CIDRS` accepts explicit IPs/CIDRs; never use a universal trust setting. Staging must configure only real proxy addresses, restrict direct API reachability and verify the edge strips forged forwarded headers before IP-based throttling is relied on. These deployment checks remain VIS-40. Cookie policy assumes UI/API are same-site in production; cross-site hosting would require a separate reviewed cookie/CSRF design.

Membership capabilities and authenticated contexts are genuine in-process objects, not client assertions. Repository operations recheck current membership/roles, business approval and session validity. Stale UI state does not grant tenant access. VIS-4 tests cover forged contexts, foreign IDs, revoked sessions and removed memberships; VIS-20 independently regresses these boundaries.

## Verification

- API suite: concurrent refresh/replay/logout, independent devices, original sign-in/refresh deadlines, expired access recovery, malformed cookies, production cookie flags, browser/native credential separation, CSRF rejection before mutation and trusted-proxy behavior.
- Exported browser regression: actual cookie refresh after forced access expiry, no ordinary token persistence, cross-origin logout denial, failed-network logout preservation, successful logout/cookie removal and family revocation.
- Foundation transport tests, 28 Storybook stories, typecheck/lint, both native bundle exports and clean-source isolated infrastructure checks.

Production TLS/proxy checks, actual native SecureStore behavior and live provider consent/delivery remain their respective staging/native issues.

References: [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Fastify trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

# Shared providers (VIS-45)

## Customer journey and URL contract

A business shares `https://<configured-web-host>/p/<slug>` or a QR encoding exactly that URL. Slugs use 1–80 lowercase ASCII letters/digits with single internal hyphens; creation fixes the slug and current business editing cannot rename it. There is no global directory, count, search or single-business bypass.

The `/p/[slug]` Expo Router route previews an approved, published, non-deleted business. Anonymous users sign in with one bounded, allowlisted `returnTo` path; phone, email (including a new callback tab), and Google code/PKCE preserve this path. A focused route in an active app automatically POSTs a save after authentication and continues to booking. Public GET/prefetch requests cannot save or create accounts. Saving implies no marketing consent, membership, application or booking.

The same route shape parses `visit://p/<slug>` through the existing Expo Router scheme. Canonical HTTPS QR links are the sharing contract; production domain association, installed-app routing, cold/warm start and real iOS/Android interaction require VIS-43 evidence. Browser tests and native JavaScript exports do not prove these behaviors on devices. VIS-35 owns provider copy/share/QR controls; this task adds no camera scanner or new native dependency.

## APIs and ownership

- `GET /api/provider-links/:slug`: minimum public name/location/category/timezone and canonical path, published-only, no save.
- `POST /api/me/providers`: authenticated, CSRF protected, strict `{slug}` or `{businessId}`. Session ownership is rechecked under a session lock; publication is rechecked under a business lock. Unique `(identityId,businessId)` upsert makes repeated activations idempotent. Optional `X-Visit-Expected-Identity` is a compare-only guard against an account changing during a pending activation, never an identity selector.
- `GET /api/me/providers`: authenticated identity scope, newest-first pagination (50 rows, opaque saved-record cursor checked against the same identity). No arbitrary identity query parameters.
- `DELETE /api/me/providers/:businessId`: idempotent removal of only the current identity's saved relation. No appointment, identity, membership or history writes.

SavedProvider is an explicit global identity-owned tenancy exception with a required business FK. A save snapshots only the then-public business name. If that business becomes unpublished, unapproved or soft-deleted, its entry remains unavailable and exposes that saved name and ID, without later private draft metadata. Hard deletion is restricted while saved references exist; a future deletion workflow must use a tombstone or deliberately reconcile these references and appointment retention. Existing customer-owned appointments retain their separate management routes.

Private query caches clear on logout/account/workspace context changes. In-flight link activations bind identity and context version; late responses cannot navigate a new account. The booking route reuses a private successful-save marker to avoid a second POST immediately after link resolution. VIS-46 removal must clear that marker and invalidate the saved list. No pending credentials or provider intents are added to persistent browser storage. Network failures expose retry; retries do not duplicate saved records.

## Verification and limits

Migration `20261025122500_saved_providers` adds the unique relation and a soft-deletion guard to the authoritative booking trigger. Integration tests cover public non-mutating previews, strict auth/CSRF/identity selection, parallel idempotency, unavailable projections, required references, account-scoped deletion, pagination and save/unpublish serialization. Browser smoke covers phone/email/Google return paths, retry after resolver/save failure, two accounts, cross-device persistence and expected-identity rejection. Auth navigation tests reject encoded traversal, external returns, extra query/hash data and malformed slugs.

The broader API suite exposed the pg adapter's structured `DriverAdapterError.cause.kind = TransactionWriteConflict` COMMIT failure, which bypassed the existing P2034 retry. The shared transaction retry now handles both structured representations with at most three attempts and then returns 409. Unit tests cover both formats and prove unrelated/domain errors are not retried; this does not substitute for the sustained concurrency workload in VIS-17.

Final local checks: 155 API tests (`NODE_ENV=test`), 26 mobile foundation tests, the complete exported-web browser suite and 47 Storybook tests passed. Root typecheck/lint, API test-source typecheck, all 18 migrations and iOS/Android JavaScript exports passed. The expanded browser harness waits for authenticated account hydration before asserting server language persistence; clicking guest controls during document bootstrap is not proof of a server preference write. VIS-46 will distinguish bootstrap/loading from private Home state.

Commit/PR evidence is recorded in Linear. Native installed links, live identity providers and staging remain release gates. No production business was published or outbound notification sent by these fixtures.

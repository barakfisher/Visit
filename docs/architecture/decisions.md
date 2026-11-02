# Architecture and product decisions

## Current pilot amendment — 2026-10-25

[pilot-product-journey.md](pilot-product-journey.md) supersedes earlier discovery, initial routing, timezone rollout and selection-time-hold assumptions. One identity retains customer capability plus approved provider memberships. Provider URL/QR acquisition automatically saves to the authenticated identity's My Providers list; public link preview GET does not mutate lists or grant management rights. Ordinary login lands on Home with upcoming appointment, compact saved providers and a minimal hamburger menu. No global directory/search, counts-based bypass or bottom tabs.

Pilot business schedules/display use Asia/Jerusalem, while durable booking instants remain UTC and DST-aware. Historical non-Israel businesses/fixtures need explicit migration review; no blanket relabeling or shifted appointments. Compact service dropdown/calendar/nearby available slots lead to exact appointment review and verified contacts, with no capacity hold until final explicit booking consent. Then use owner-bound Redis coordination plus authoritative idempotent PostgreSQL commit/recovery. Phase 2 free-text assistance is deferred and cannot mutate bookings or bypass deterministic checks.

Implementation is tracked in VIS-13/24/26/27/28/29/34/35/45/46/47; VIS-22 is canceled and VIS-48 is deferred. Earlier completed foundations keep their commit/test evidence; the amendment does not certify the new product flow. Native VIS-2 → VIS-43 → VIS-25 and operational release gates are unchanged.

## Historical baseline

Status: VIS-1 baseline with production-plan decisions reconciled for VIS-9, 2026-10-24. Target contracts do not certify implementation completion.

## Confirmed with the product owner

| Area | Decision |
| --- | --- |
| Mobile and web client | Expo + React Native + TypeScript + Expo Router; shared single-brand UI |
| Design system | NativeWind |
| Server data | TanStack Query; Zustand only for transient client UI state |
| API | Node.js + TypeScript. Use Fastify for the HTTP boundary: small, typed plugin model and good schema validation support. |
| Database | PostgreSQL with Prisma migrations and generated client |
| Cache and coordination | Redis for ephemeral coordination only; booking correctness remains a PostgreSQL invariant |
| Email authentication | Passwordless email sign-in link, single-use and expiring; never activate or link an email identity before verification |
| Provider onboarding | Identity-only login; post-login new-business applications require admin approval. Existing-business joining requires invitation or verified ownership. Approved providers switch customer/provider modes from the account menu. |
| Google authentication | Authorization code + PKCE and explicit authenticated account linking; never merge accounts on matching email alone. Existing ID-token-only implementation must be replaced under VIS-15. |
| Phone authentication | Live Twilio Verify; isolated Redis development/test challenges; expiry, single-use/replay protection and throttling on both paths. |
| Business publication | Approval and publication are separate. Approved providers configure draft businesses and publish only after server-side readiness validation. |
| Booking policy | Each business configures its own booking window, buffers, and cancellation/rescheduling policy |
| Staff capacity | Defaults to one concurrent appointment per staff member; capacity is checked across the complete occupied interval |
| DST | Reject nonexistent local times during spring-forward; require an explicit offset/fold choice for ambiguous fall-back times. Persist booking instants in UTC and retain the business IANA timezone for display and recurring schedules. |
| Brand and scope | One shared brand across tenants. Pilot requires live authentication and approval/rejection notifications; appointment messaging remains labeled placeholders. No payments, independent branding, or full native E2E automation; record native manual smoke separately. |

## Tenant and identity boundary

- `Business` is the tenant root and uses its primary key as the business identifier.
- Identity, authentication credential, and session records are global. A person can hold memberships in multiple businesses and may also book as a consumer.
- Business-owned staff, services, schedules, overrides, booking policies, bookings, and provider approval requests carry a non-null `business_id`.
- Every provider operation resolves an authenticated identity and verifies an active membership and role on the server. A client-supplied `business_id` is only a selector, never proof of access.
- Tenant-owned references use composite keys/foreign keys that include `business_id`, so cross-tenant references fail at the database boundary too.
- A provider applicant has no provider permissions until approval is recorded and an active membership is created. Existing approved memberships are not implicitly granted to other businesses.

## Booking invariants

- Occupied ranges are half-open `[start, end)`: adjacent appointments can touch; any true overlap conflicts.
- The occupied interval includes service duration plus configured pre/post buffers. Overlap checks use full intervals, not equal start times.
- The default per-staff capacity is one. If a business configures higher parallel capacity, all overlapping intervals count against it.
- Availability is advisory. Booking confirmation rechecks authorization, policy, and capacity transactionally in PostgreSQL.
- Redis holds use random owner tokens, bounded TTL, atomic acquire, and compare-owner-and-delete release. Redis loss or expiry cannot permit an invalid database booking.
- Booking mutations accept idempotency keys. Rescheduling commits the new allocation and releases the old allocation atomically; on failure, the original booking remains intact. Cancellation is idempotent and releases capacity once.
- Store recurring schedules as local times associated with a business IANA timezone; store actual bookings as UTC instants. Nonexistent DST wall times are invalid; ambiguous wall times require an explicit offset/fold choice.
- Business policy owns minimum notice, maximum booking horizon, buffers, cancellation cutoff, and reschedule cutoff. Define safe configurable defaults in the policy schema and require an explicit business policy before accepting bookings.

## Phase 1 integration contracts

- Monorepo packages: `apps/mobile` (Expo native/web), `apps/api` (Fastify), and shared TypeScript contracts/UI packages as needed.
- PostgreSQL is the durable source of truth. Prisma owns schema and migrations. Redis never replaces database invariants, but is a required dependency for current rate-limit and reservation routes. These fail closed on Redis outage; readiness requires database/migration health and Redis.
- HTTP errors use stable machine-readable codes and safe human-readable messages. Validation errors are field-addressable; authentication and authorization failures do not disclose tenant or account existence.
- UI query keys include authenticated identity and selected business where relevant. Switching business clears or invalidates business-scoped cached and transient state.
- CI uses disposable PostgreSQL and Redis services, deterministic fixtures for at least two businesses, and runs lint, typecheck, unit/API checks, Storybook build, and web smoke/E2E checks as those foundations land.

## Open implementation details

- Resend is the initial production email adapter; configure its secret and verified sender on the server. Passwordless email, Google code + PKCE and phone OTP are in pilot scope. Disabled/unconfigured options must be labeled honestly. Hosting/deployment target is decided in VIS-40; real authentication/native evidence is VIS-43.
- VIS-10 adopts configurable onboarding prefill: 60-minute notice, 60-day horizon, zero buffers, and 24-hour cancellation/reschedule cutoffs. Providers must explicitly save the policy; no universal cutoff activates silently. See [scheduling policy](scheduling-policy.md).
- VIS-32 delivers admin-only review, recorded approval/rejection reasons and applicant notification status. VIS-33 prevents arbitrary existing-business ownership requests. VIS-34/35 deliver readiness and provider setup; approval alone never publishes.
- Language policy confirmed for VIS-31: Hebrew and English, Hebrew default, account-settings language switch, persisted account preference and RTL Hebrew layouts. See [localization policy](localization.md) for bidirectional rendering and validation scope.

## Identity/navigation contract

See [Identity, provider capability and navigation](identity-and-navigation.md) for the post-login routing precedence, mode preference, business selection, authorization boundaries, stale-state recovery and shared transition matrix. This supersedes the original forced-role/onboarding assumptions.

## Browser test isolation — 2026-10-28 (VIS-14)

- **Choice:** the database-backed browser suite (`npm run test:web`) runs against a dedicated `visit_test` PostgreSQL database and Redis logical database `1`. `apps/mobile/scripts/test-environment.ts` assigns every API setting explicitly, so the API's own `.env` loading can supply none of them (dotenv never overrides keys that are already set). Locally it defaults to the docker-compose local-only credentials. CI passes `VISIT_TEST_DATABASE_URL` and `VISIT_TEST_REDIS_URL`. The harness refuses any other database name, Redis database `0`, a non-loopback host or `host`/`port` query overrides, and reports a malformed override without echoing it, and applies committed migrations to `visit_test` before each run (Prisma creates the database on first use). The session secret is random per run.
- **Rejected: keep running against the development database and Redis, with per-test ID cleanup.** A run that crashed before cleanup would leave synthetic businesses, identities and bookings in the developer's data. The suite also resets rate-limit keys in the same Redis keyspace the running dev API uses. And whatever happened to be in `.env` (Google, Twilio, delivery modes) silently shaped test behaviour, so a run could pass on one machine only.
- **Rejected: a separate Postgres/Redis container per run.** Isolation would be stronger, but it adds container orchestration to every local run and slows feedback, while a dedicated database and keyspace already remove the failures above.
- **Consequence:** the API's own `env.ts` still calls `dotenv.config()`. It never overrides keys that are already set, and the harness sets all of them. `env.ts` exports `environmentKeys`, and the harness refuses to start if any key is missing from `testEnvironment()`, so a new API setting cannot silently take its test value from `.env`. Keys outside the API schema can still be loaded into the process, which the static web server inherits; they don't affect the API. `expo export` separately reads `apps/mobile/.env*` for `EXPO_PUBLIC_*` values, outside this decision. Prisma created `visit_test` on first `migrate deploy` locally; the first hosted CI run must confirm the same there.

## Booking resilience browser proof — 2026-10-28 (VIS-14)

- **Choice: prove an outage with the API's real failure, not a faked browser reply.** `booking-resilience-smoke.ts` closes the in-process test API's own Redis client, so `/api/bookings/commit` answers its real `503 LOCK_UNAVAILABLE`, then reconnects in `finally`. A separate case aborts the request in the browser for "never reached the server". The Redis server, db 1 and the dev API's own connection are untouched.
- **Rejected: fake the 503 in the browser only.** It would prove the screen, not the server: a regression that hung or answered 500 when Redis is down would still pass.
- **Choice: a slot goes stale only when other real customers fill every remaining place.** The lifecycle business's staff member takes two appointments at once, so one rival booking leaves the slot bookable and the app is right to keep the choice. Each rival is a separate customer, so the proof does not rely on the open self-overlap question below.
- **Choice: refusals that end a new-booking attempt show the app's localized message** (`bookingCommit.conflict`, or `bookingContact.help` for `CUSTOMER_CONTACT_REQUIRED`). Before, the booking screen displayed the server's English diagnostic, so a Hebrew customer read "That time was just booked" in English. Rejected: localize server messages; they are diagnostics, and the client already owns the copy. Rejected: the same generic copy for reschedule refusals; it would tell a customer past the reschedule cutoff to "choose another time", which is refused again. Reschedule refusals keep the server's specific (English) reason until the reschedule slice gives them localized copy.
- **Open decision: may one customer hold overlapping bookings, and how many bookings may one customer make?** Nothing in the API or database prevents either: there is no per-customer overlap rule, booking cap or rate limit on `/api/bookings/commit`. On a slot with places left, one customer confirming the same time from two tabs (or twice, one after the other) gets two bookings; each tab is its own attempt with its own idempotency key, so idempotency cannot join them. Legitimate for "one account books for two children", wrong for an accidental second tab, and abusable: one account can take every remaining place of a slot, or many slots, with fresh keys. Options: allow; reject a customer's overlapping booking; cap bookings per customer; rate-limit commits. The resilience smoke records today's behaviour (two bookings) and must change with this decision.
- **Observed, not asserted: truly simultaneous confirms can conflict while a place remains.** A short exclusive Redis lock (`redis-slot-lock.ts`) per staff member over every minute of the occupied interval (buffers included) is tried once; a second concurrent attempt on the same or an overlapping interval for that staff member is rejected with `409 CONFLICT` (it does not wait), regardless of capacity, and its attempt is marked rejected. The outcome depends on timing, so the browser proof confirms sequentially; concurrency belongs to VIS-17.
- **Not covered: retry after a page reload.** The uncertain attempt lives only in memory, so a reload loses its idempotency key and a retry is a new attempt. On a slot with places left that can create a second booking. VIS-17.

## Keyboard focus reveals the whole calendar date — 2026-10-29 (VIS-11)

- **Finding:** Chromium scrolls a focused element only when it is entirely out of view. In `HorizontalCalendarBar`, a date partly cut off at the strip's edge stayed cut off after keyboard focus. CI's Linux fonts made the Hebrew desktop row 26px too wide, so the 12th date kept 18px hidden. macOS fonts fit the row, so the case never appeared locally.
- **Choice: the app reveals the whole date.** On web, a date calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on focus. The Storybook check stays strict: after focus the whole date is inside the strip. Stories that clip a date on purpose make the proof independent of each OS's fonts.
- **Rejected: assert only that the focused date is partly visible.** That matches Chromium and WCAG 2.4.11 (AA), but a keyboard user would still read a half-hidden date, and the old check already hid this case by skipping it when the row happened to fit.
- **Rejected: assert that the strip scrolled when it overflows** (the original check). Overflow does not mean the date is hidden, and scrolling does not mean it is fully shown.
- **Scope:** only the calendar strip, a legacy component. Other horizontally scrolling controls keep Chromium's default until a story shows the same problem.

## Appointment retention browser proof — 2026-10-31 (VIS-14)

- **Choice: the slice continues on the lifecycle business, in its provider's and customers' own signed-in browsers.** `pilot-lifecycle-smoke.ts` returns each browser's saved state (`storageState`), and `appointment-retention-smoke.ts` resumes it. Nothing is seeded, so reschedule, cancel, removal, unpublish and republish all act on a business and appointments made through the UI.
- **Rejected: sign the same phones in again.** The per-phone OTP cooldown refuses a second code for the same number within minutes. It passed only when the resilience suite in between ran long enough, so the result would have depended on timing.
- **Choice: hold expiry on unpublish is cited from `apps/api/test/publication.test.ts`, not re-proven in the browser.** In the app a HELD row exists only inside a commit (final consent), so no customer can hold a time when the provider unpublishes. The browser proves the case a customer can reach instead: confirming a review after the business was unpublished is refused (`404 NOT_FOUND`), in their language, and nothing is written.
- **Rejected: pause a commit inside the server to create a hold mid-flight.** It needs a test-only hook in the commit transaction and duplicates the API proof without covering anything a customer can do.
- **Cited, not re-proven:** calendar export (`web-smoke.mts`, `booking-success-smoke.ts`) and business switching (`web-smoke.mts`) already run on seeded businesses, and nothing in them depends on how the business was created.
- **Choice: cutoff refusals have their own API codes and the app's own copy.** The API answers `409 RESCHEDULE_CUTOFF` or `409 CANCELLATION_CUTOFF` instead of a generic `CONFLICT`. The app maps them to `lifecycle.rescheduleCutoff` and `lifecycle.cancelCutoff` on Home, the appointment details and the reschedule screen. Every other reschedule refusal now shows the app's localized copy too, which replaces the 2026-10-28 exception that kept the server's text for reschedules: that exception existed because generic copy would tell a customer past the cutoff to choose another time, and the cutoff now has copy that says why.
- **Choice: a booking screen that cannot load shows the app's copy, not the server's message.** The reschedule and booking screen used to render the error message from its business-details request as is. After a refused change refetches, that request is itself refused, so the Hebrew screen showed "The requested resource was not found." in English. `bookingLoadRefusalKey` keeps a cutoff's own copy, maps 404 to `providers.unavailable` (not found and unpublished answer alike, so the client cannot tell them apart), and maps anything else to `compact.detailsFailed`. *Rejected:* localizing the server's messages in the API, which would make every server string part of the client contract and still leave unknown errors raw. The browser proof checks that the visible alerts are exactly the expected localized messages after the action settles.
- **Rejected: keep showing the server's message for reschedule refusals.** A Hebrew customer read English, both past the cutoff and when another customer took the time.
- **Rejected: rely on hiding the actions.** Inside the window Home and the details screen hide Reschedule and Cancel, but a page opened before the provider changed the policy still offers them, and the refusal then reached the customer as a generic failure (cancel) or English text (reschedule).
- **Finding, not fixed here:** when the business is unpublished during review, the refusal says "This attempt expired or the time changed. Choose an available time again." while no time can be booked. It is localized, but it points the customer at an action that cannot succeed.
- **What "unchanged in Redis" means here:** no hold record and no reservation entry is left for the refused attempt, and every remaining entry belongs to a confirmed booking (`assertNothingHeld`). Confirmed capacity lives in PostgreSQL; Redis reservation entries expire with the hold, so an older confirmed appointment legitimately has none. Rejected: comparing a booking's Redis entries before and after, which fails whenever the hold expires in between.

## Signed-out Home opens login — 2026-10-31

- **Choice: Home redirects a signed-out visitor to `/auth/login`.** `app/(tabs)/index.tsx` redirects once the session has bootstrapped with no identity. Home is personal (next appointment, My Providers), so a guest had only the title, one line and a sign-in button, which read as a broken page. Login already carries the product welcome copy and the provider registration entry. Sign-in returns to Home as before.
- **Kept:** while the session is bootstrapping, and when the session lookup fails, Home still shows `SessionLoading` with its retry. An unresolved or failed lookup is not treated as signed out, so a network error never bounces a signed-in person to login.
- **Rejected: a separate welcome screen** with how-it-works steps before login. It adds a screen and a tap before the only thing a guest can do, and has no product spec or brand assets (the app icon is still Expo's placeholder).
- **Rejected: keep the guest Home.** It duplicated the login entry and showed the personal Home heading to someone with nothing on it.

## Email and password sign-in for the MVP — 2026-11-01

- **Choice: until the MVP ends, people sign up and sign in with email and password, and the email is trusted without proof.** Real customer and provider accounts are needed to test the system, email delivery is not configured, and the email-link flow only works locally through the development inbox. Details and the local test-account steps are in [password-authentication.md](password-authentication.md). This replaces, for now, "No password or ownership bypass is introduced" in [email-authentication.md](email-authentication.md).
- **Choice: the email is marked verified at sign-up**, so booking contact rules, team invitations by email, administrator promotion and review notifications all work. *Accepted risk:* whoever signs up first with an address owns it in Visit, including team invitations sent to it. `PasswordCredential.unprovenEmail` marks these accounts for re-verification.
- **Choice: proving the address wins over the unproven password.** The real owner's email-link sign-in deletes a password registered with that address without proof and ends its sessions; removing the email removes the password. *Rejected:* keeping the password, which would leave whoever registered first inside the owner's account with no way for the owner to see or remove it.
- **Choice: only failed passwords count against an address.** *Rejected:* counting every attempt per address, which let anyone lock a person out indefinitely by trying their email.
- **Rejected: keep the email unverified.** Safer, but invitations by email, administrator promotion and review notifications would need email verification, which needs the delivery the MVP does not have.
- **Rejected: a development-only "sign in with any email" switch.** It would not create real accounts that survive into a hosted test environment, and it removes every proof, not only the email one.
- **Choice: scrypt from `node:crypto`, not a password-hashing package.** It is a memory-hard key-derivation function built into Node, so nothing new to install or audit; the hash string records its parameters so they can be raised later.
- **Choice: phone sign-in shows only when SMS is configured** instead of being removed from the login screen. In the development setup SMS is off, so it is hidden; the browser suite configures SMS, so the phone journeys keep their coverage.

## Provider setup guide before the agenda — 2026-11-01

- **Choice: an unpublished business that cannot publish yet, and has no appointments, sees only a setup guide on its dashboard.** (Since 2026-11-02 the dashboard redirects to business settings, which is this guide.) The guide lists the five steps publishing needs (details, services, staff, hours, booking policy), each with its status and the hint for what is missing, and opens the setup screen at that step (`/provider/[businessId]?section=…`). The agenda, manual booking, catalog and hours tabs appear once every step is complete. A newly approved owner used to land on an agenda, a disabled Publish button and a list of blockers, and could not tell where to start. The rule lives in `needsSetupGuide` (`src/lib/BusinessReadiness.ts`).
- **Choice: a business with appointments always keeps its agenda.** The readiness response carries `hasAppointments` (any confirmed, completed, no-show or cancelled booking). *Rejected:* gating on `publishedAt` alone, which would hide booked customers from a business that unpublished and then broke a setup step, such as deactivating its last service.
- **Choice: no refresh button and no polling for readiness.** Every setup save already invalidates `['provider', businessId]`, and the dashboard remounts on focus, so the checklist is current when the owner returns. *Rejected:* keeping the 10-second poll and the "Refresh publishing checklist" button, which asked the owner to do the app's job.
- **Choice: Publish appears only when the business can publish**; the unpublish note appears only next to Unpublish. *Rejected:* a disabled Publish button, which read as broken next to the blockers that explained it.
- **Choice: business settings live in the provider-mode menu**, with the agenda next to them (`nav.businessSettings`, `nav.agenda`), not on the dashboard. The menu is the app's standing navigation, so settings are reachable from every provider screen; once set up, an owner opens them rarely, and before that the guide's primary button leads there. *Rejected:* a link at the bottom of the agenda (hard to find); a button under the business name (took a permanent row on the agenda for an occasional task); a fourth dashboard tab, which would sit beside the Service Catalog and Working Hours tabs that already repeat two setup sections. That duplication is an open question. (Resolved 2026-11-02: the tabs are removed, and the menu's Agenda item became Home.)
- **Bug, as a lesson:** the publication card, the service catalog and the hours editor were siblings that all used `key={business.id}`. React matches siblings by key, so switching tabs left the previous publication card mounted and every switch added another. Sibling keys must be unique even when they identify the same business; they are now prefixed by role (`publication:`, `services:`, `hours:`).

## Business settings hub with one screen per section — 2026-11-02

- **Choice: the setup guide is the business settings screen** (`/provider/[businessId]`, title "Business settings"), and every section is its own screen (`/provider/[businessId]/[section]`). The vertical section tabs, the page-wide intro and the publication card under them are gone. The user found the tabs took most of the screen and repeated what the guide already showed. A business that cannot publish yet is redirected there from its dashboard. *Rejected:* keeping the tabbed page as "settings" beside the guide, which would show the same six steps two ways.
- **Choice: saving a single-form section (details, hours, policy) returns to the hub; services and staff stay in place** (`RETURNS_ON_SAVE`). The owner sees the step turn complete right away. *Rejected:* always returning, which would send an owner adding five services in and out five times.
- **Choice: hours come before staff,** because staff hours default to the business hours.
- **Choice: publishing is the sixth step and shows only the publication card.** Sharing (link, system share, QR) moved to `/provider/[businessId]/share`, opened by a "Share your business" link on the agenda that appears only once the business is published. Before then the agenda shows a small amber warning that links to the publish step. *Rejected:* sharing on Account (the account belongs to a person who may manage several businesses) or as a permanent menu item (an occasional action holding a standing slot).
- **Choice: the agenda's Service Catalog and Working Hours tabs are removed.** Settings are reachable from the menu on every provider screen, and keeping a second copy of each editor would double the work in the planned services and hours redesigns. The cost is one more tap to change a price or hours, which owners do rarely.
- **Choice: in provider mode, Home opens the active business's agenda, and Team access is a menu item** instead of a link inside settings. Team access is about people, not business configuration. The separate Agenda menu item is dropped, because Home now goes there. Leaving provider mode stays the explicit "Switch to customer mode" item.
- **Open:** what an invited Staff member can see. Today Staff access links no scheduling resource and opens no workspace (business-access.md); a Staff screen and people working in several businesses are a separate piece of work.

## Services and booking policy settings — 2026-11-02

Task 2 of the business-settings redesign (handoff `2026-11-02-settings.md`). The user chose each item below.

- **Choice: the service form opens in a dialog** (`FormDialog`: a bottom sheet under the compact breakpoint, a centred dialog above it) from a "+ Add service" button in the catalog's header row, or from a card's "Edit service". It is never shown on the page by default. Saving closes it and keeps the owner on the services screen. *Rejected:* a separate page per form (`/services/new`, `/services/[id]`), which would send an owner adding several services back and forth, and would need new `safeAuthReturnTo` entries, the miss the browser suite caught in PR #29. The cost: no deep link to one service's form, and a reload drops an unsaved draft.
- **Choice: the add button is a plus with text** (`AddButton`), and staff will reuse it in task 4. The user first chose a plus alone, then changed it to plus and text, and may revisit. The plus is two drawn bars: `react-native-svg` breaks the Storybook web build, and the app ships no icon font. *Rejected:* a bare "+", which an owner can miss or misread next to a heading.
- **Choice: the separate "Archive"/"Restore" button is gone; pausing a service is an "Available for booking" switch in the edit form.** A card has only "Edit service" and "Delete", and a paused service shows "Not available for booking". *Rejected:* only "Delete", which would leave no reliable way to pause a seasonal service, because the server permanently deletes a service with no bookings. *Rejected:* keeping three buttons on every card.
- **Choice: "Delete" keeps the server's delete-or-archive behaviour** (`deleteBusinessService`). Pressing it shows an explanation with "Confirm" and "Cancel" side by side. A service with booking history is switched off instead, the message says so, and the edit form's switch brings it back.
- **Choice: no currency field. New prices are ILS** (`DEFAULT_SERVICE_CURRENCY`), and the price hint says so. Editing keeps a service's stored currency, so a legacy non-ILS row is never silently relabelled. The API still stores currency per service, so there is no migration. *Rejected:* forcing ILS on edit, which would change the meaning of an existing price.
- **Choice: the cancellation and reschedule cutoffs are typed in whole hours**, while the API keeps `*CutoffMinutes` (`BookingPolicyForm`). A stored value that is not a whole hour (only possible from the old minutes form) shows as decimal hours and is saved back unchanged if untouched. *Rejected:* rounding on load, which would silently change a saved rule the next time the owner saves anything.
- **Choice: "Minimum notice" is now "Latest booking before start (minutes)", and "Booking horizon" is "How far ahead customers can book (days)".** Each has a live sentence under it that uses the typed number ("Customers can book up to 60 minutes before an appointment starts."). The user didn't understand the old names, and a name alone still leaves the number's direction ambiguous. *Rejected:* names without the sentence.

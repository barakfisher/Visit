# Visit pilot: organic onboarding and reviewed local booking
Approved product revision: 2026-10-25. This is the target product contract; existing code and completed foundation evidence do not prove the revised UI is implemented.

## Primary milestone
A new provider uses one account to apply, obtain administrator approval, configure and publish an Israeli-local business, share its URL/QR, and receive its first real booking. Release remains VIS-25 → VIS-44, including native VIS-2 → VIS-43 evidence.

## Product decisions
- One global Account/identity. Every signed-in person can book as a customer; active approved business memberships add management rights. No second customer account, role selector or automatic privilege from a saved provider.
- No global Explore/Discover directory, search/category/location filters, directory provider counts or single-global-provider bypass. VIS-22 is Canceled, not Done. Legacy /discover redirects Home safely; remove/disable the enumerable directory API during implementation.
- Provider acquisition is a canonical public URL or QR encoding the same URL. Anonymous link open → preserve validated provider intent → authenticate → idempotently save to My Providers → continue specific provider booking. Signed-in open saves once and continues. Normal login always lands Home, including approved providers.
- My Providers is an identity-owned preference relation, not tenant membership or marketing/notification consent. Unique identity/business pair; authenticate writes, enforce CSRF/native boundaries and publication. Link preview/crawler GET never mutates lists.
- Pilot schedules/display use Asia/Jerusalem, independent of language and traveler device timezone. Absolute booking timestamps remain UTC; never hard-code UTC+2/UTC+3 or silently relabel old businesses/confirmed bookings.
- Service/date/time selection and review are advisory. Only final explicit booking consent acquires owned bounded Redis capacity reservation, then PostgreSQL confirmation. Redis and PostgreSQL are not a cross-store atomic transaction; idempotency, ownership, expiry, crash recovery and DB guards remain mandatory.
- Hebrew default + English and RTL/LTR remain required. “Your time, well spent” is the English Home title, with a consistent Hebrew translation. Unsupported future actions remain disabled/labeled, never fake successes.
- Phase 2 NLP assistance is deferred until deterministic booking and pilot evidence are stable. No autonomous booking, new global directory or pilot release dependency.

## Customer journey
1. Ordinary launch/authentication → Home. Direct provider link/QR → provider intent → authentication when needed → automatic identity-scoped save → that provider's booking. Provider registration entry follows the same authentication, then application, not another account.
2. Home: title, earliest upcoming confirmed active appointment if any, then compact My Providers cards with direct Book actions.
3. Empty Home: “You haven't added any providers yet.” Explain asking a business for its Visit link/QR. No Explore CTA. OS camera opening the QR URL is sufficient; an embedded camera scanner is not pilot scope.
4. Select provider → service dropdown. One service auto-selects; zero services explains unavailability. Compact service summary shows duration and price.
5. Calendar button opens a pop-up/sheet; closed dates/out-of-window dates are disabled from real business rules, not assumed weekends.
6. “Around what time?” is a preference filter. Return a concise chronological set of real nearby available slots with Earlier/Later and next-available-date recovery. Hide unavailable slots.
7. Review exact business/service/staff where applicable, Israeli date/time, duration, price, contact and cancellation requirements. Complete verified contact before final consent. No capacity hold/countdown during browsing/review.
8. Final Book → bounded owner reservation → authoritative idempotent DB commit → persisted success/details/calendar export → customer Home and provider agenda. On conflict/outage show truthful recovery and refresh/remove stale candidate; never silently substitute.
9. Appointment details/reschedule/cancel/history remain reachable from Home/Account. Removing a saved provider or unpublishing does not erase owned existing appointments or policy-allowed actions.

## Minimal menu
Home; Account; Become a provider for regular customers; Application status while pending/rejected; Switch to provider mode only with active approved capabilities; Log out. Provider mode offers Switch to customer mode and clear selected business. A person may have approved businesses plus a separate pending application, so status and mode access can coexist. Multiple business management requires allowed workspace selection. No bottom tabs or sticky “Back to Visit”.

## Provider/admin journey
Provider entry from login/account → same identity authenticates → new-business application → pending/rejected status with customer access retained → admin reason/actor/time decision and truthful notification → approved unpublished setup → profile/services/staff/hours/buffers/contact/cancellation readiness → publish → copy/share URL and QR → first reviewed customer booking appears in agenda.
Business customer links never join staff/owner roles; VIS-33 invitations/verified ownership are separate.
Approval is not publication. Shared links for unpublished providers do not enable new saves/bookings. Existing tenant migrations are conservative and do not shift booking instants.

## Backlog ownership
| Issue | Current responsibility |
| --- | --- |
| VIS-13 | Identity-only login + provider entry, ordinary Home routing and safe provider/booking intent |
| VIS-32 / VIS-33 | Application/admin review and separate existing-business membership invitation |
| VIS-47 | Asia/Jerusalem pilot rollout, historical-data safety and DST/local display contract |
| VIS-34 / VIS-35 | Publication/readiness and provider setup with canonical copy/share/QR tools |
| VIS-45 | Identity-owned My Providers persistence and canonical provider-link resolution/save/auth resume |
| VIS-46 | Home, empty/saved/readonly-upcoming states, minimal drawer and bottom-tab/directory cleanup |
| VIS-27 | Application/mode transitions integrated with the drawer and current permissions |
| VIS-36 / VIS-26 | Verified contact before final consent; owned reservation and authoritative idempotent commit |
| VIS-24 | Compact dropdown/calendar/nearby-time UI and pre-booking review |
| VIS-28 / VIS-29 / VIS-30 | Persisted success/details/calendar, Home appointment actions, atomic reschedule/cancel |
| VIS-11 / VIS-14 / VIS-17 / VIS-20 | Styled components, shared-link full lifecycle, final-click concurrency and security regressions |
| VIS-48 | Deferred Phase 2 assistant over authorized saved providers only |
| VIS-22 | Canceled legacy global discovery/search |

## Priority and sequence
1. Ready Todo: VIS-13, VIS-47 and VIS-32. All have completed prerequisites; only executing implementation becomes In Progress.
2. Provider foundation: VIS-33 in parallel; VIS-32 + VIS-47 unlock VIS-34. Published-link/persistence VIS-45 follows VIS-34; then provider share/setup VIS-35 and Home VIS-46 can finish against real contracts.
3. Booking: VIS-36 → VIS-26 (also requires VIS-47) → VIS-24 (also requires VIS-45). VIS-27 follows Home/auth/application/invitation integration. Lifecycle/agenda/reschedule/details/widget issues retain their explicit data dependencies.
4. CI/staging/monitoring/backups can proceed when their own blockers clear; they are not deferred because the directory was removed.
5. Full component/lifecycle/concurrency/security verification → VIS-25 gates → VIS-44 first real booking.
6. Phase 2 VIS-48 follows pilot and deterministic locking validation; it blocks no pilot work.

Milestones are undated scope groups, not commitments to capacity/dates. Explicit Linear blockers govern actual execution. Home's basic read-only upcoming widget does not wait for all reschedule/cancel operations; those actions remain disabled until VIS-29/VIS-30 completion.

## Required acceptance changes
- Link/QR: fresh vs signed-in open, duplicate scans, login cancellation/retry, invalid/unpublished links, crawler/prefetch no-write, logout/account changes, cross-device saved lists and no management privilege from saving.
- UX: zero/one/many saved providers, normal Home landing for approved providers, conditional drawer, single-service selection, closed dates, real nearby slots, readable compact RTL/LTR and no global search.
- Booking: zero hold writes during review, explicit final request, same-slot barrier race with nondeterministic winner, stale loser removed from choices, idempotent lost-response recovery and no false success.
- Time: Israeli DST/midnight/traveler display and calendar instants, preserving UTC storage; no fixed-offset assumptions.
- Release: genuine iOS/Android boot/app links/QR handoff and live configured auth/delivery remain VIS-43, plus staging/protected CI/monitoring/restore evidence. Local bundles/tests never substitute.

## Current implementation evidence
Sixteen foundation issues remain Done; VIS-2 stays In Review for actual native evidence. The new/revised issues remain Todo/Backlog; none is marked Done by this planning revision. Existing commits through eb5cf4b and their test evidence remain historical foundation coverage. This scope change runs no app tests and implements no runtime UI or database migration. Actual migration/testing work belongs to the open issues above.


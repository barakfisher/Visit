# Owned Home appointment actions — VIS-29

## Selection and data boundary

`GET /v1/me/bookings/upcoming` authenticates and revalidates the session, then reads only the caller's future `CONFIRMED` appointments. A repeatable-read snapshot selects the earliest by `startsAt`, then `id`, and counts additional upcoming appointments consistently. Optional strict `businessId` filtering supports the booking page's contextual section; provider membership never broadens the customer scope. Unknown or unowned contexts return no appointment. All responses inherit the application's `Cache-Control: no-store` policy.

The response contains one appointment's ID/revision/status/instants, historical service snapshot, business display fields, staff display name, and server-calculated action permissions, plus `additionalCount`. It does not return customer contacts, customer/tenant internals, session data or logical booking keys. A shared pure action-policy function keeps Home and persisted details consistent. No new migration is needed; the existing customer/start index supports the query. Customer/provider history ordering also uses the deterministic ID tie-break.

Saved-provider membership and publication do not determine access to existing owned appointments. Archived service details retain their original name, duration and price. Current cutoff/missing-policy/approval rules control available actions; the authoritative mutation APIs recheck ownership, policy and revision even if a displayed permission becomes stale.

## Presentation and behavior

Home now composes typed presentation in `Home.component.tsx`, state/navigation in `Home.hook.ts`, API calls in `Home.service.ts`, and shared contracts in type files. The compact upcoming section appears above My Providers in ordinary scroll flow. No upcoming appointment renders no empty appointment card; the saved-provider empty/loading/error state remains independent. Additional appointments lead to owned appointment history. Details and reschedule use the owned booking ID; reschedule continues through the VIS-30 explicit-consent/revision/idempotency protocol.

`UpcomingAppointment.component.tsx` renders typed view props only. Its hook scopes private queries by identity, session context and optional business. Hidden/unfocused screens expose no active card; re-entry refetches. A bounded timer refreshes when the displayed appointment starts, and regular reads refresh every minute. Invalid dates never schedule invalid/overflowing timers or format an appointment. Display uses the business timezone and one friendly time-context note; the Israel pilot keeps Asia/Jerusalem, while legacy zones retain truthful labels.

Cancellation requires translated explicit confirmation, fences identity/context/route/focus/mount after the asynchronous prompt, and calls the existing owned revision-guarded endpoint. A synchronous operation guard prevents repeated submissions; controls show pending state. A failed mutation refetches persisted state and retains the original card/error only while that same appointment and context remain current. Success refreshes the next appointment and count. No cancellation success is inferred from an optimistic capacity release.

The same owned section appears in the normal new-booking page for that business, without mixing personal appointments with provider agenda. The rescheduling review itself omits the contextual section. Removing or unpublishing a saved provider retains allowed appointment details/actions.

`BookingQueries.utils.ts` defines shared booking invalidation for final booking, reschedule, cancellation from Home/details/history, and provider lifecycle outcomes. It covers `me`, `consumer`, `provider`, `booking-details`, `appointment-history`, `availability` and `booking-calendar`; unrelated account/saved-provider caches are independent.

## Verification

Fresh QA supplied API coverage for empty/authenticated ownership, tied timestamps, future/status filtering, count consistency, minimal projections, provider-role isolation, scoped/null/invalid queries, archived/unpublished/deleted business access, policy permissions, cancellation advancing selection, and revoked sessions. Pure units cover timer invalid/empty/NaN/infinite/overflow boundaries and shared invalidation prefixes. Nine new Storybook cases cover ready callbacks, hidden/null, loading/read error/retry, pending, restricted policy, retained mutation failure, and long Hebrew content.

The exported-web journey covers independent provider/appointment loading, failed read/retry, no stale card on error, deterministic selection/additional appointments, owned details, Home reschedule and reordered earliest appointment, contextual provider display, declined/failed/pending/successful cancellation, removed/unpublished provider access, no empty appointment card, Hebrew RTL and long text without horizontal overflow. The Hebrew screenshot was visually inspected. Existing full browser regression remains required.

Reproduce from the root; API and browser suites must run sequentially against the shared fixture database:

```sh
npm run typecheck
npm run lint
NODE_ENV=test npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile
```

From `apps/api`: `../../node_modules/.bin/tsc -p tsconfig.test.json --noEmit` and `../../node_modules/.bin/prisma migrate status`.
From `apps/mobile`: `NODE_PATH=./node_modules ../../node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/vis29-native`.

Local validation passed on 2026-10-27: **251 API / 65 foundation / 80 Storybook tests**, complete exported-web regression, workspace typecheck/lint, fixture compilation, 29 applied migrations and iOS/Android JavaScript exports. Logs: `/tmp/vis29-api-verified.log`, `/tmp/vis29-foundation.log`, `/tmp/vis29-storybook.log`, `/tmp/vis29-web-verified.log`, `/tmp/vis29-types-verified.log`, `/tmp/vis29-lint-verified.log`, `/tmp/vis29-native.log`. The browser preference-switch test now waits for its actual persistence response before document navigation, preventing an aborted save. Actual hosted run results are recorded against the PR head in Linear and the local handoff; local checks do not imply hosted CI success. Fresh read-only Security review found no concrete vulnerability in the owned API, minimal projection, cancellation/context guards, service extraction, cancellation signals or invalidation. QA ran isolated units/fixture compilation; integrated API/browser execution belongs to the developer. Neither audit claims physical-device testing.

Existing user runtimes on API3000/Metro8081/8082 are preserved; test services use3001/8083. Hosted account payment/spending-limit failures remain an external CI blocker unless an actual head-linked run establishes otherwise. No deployment, billing change, live messaging or physical-device acceptance is implied. Native/live-provider gates remain VIS-2 → VIS-43 → VIS-25.

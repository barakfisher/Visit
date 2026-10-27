# Provider agenda and protected schedule edits — VIS-18

## Daily and weekly agenda

`GET /api/provider/agenda?businessId=…&date=YYYY-MM-DD&days=1|7` requires an approved OWNER/MANAGER membership. The selected date and range use the business IANA timezone; weekly ranges start on Sunday. Each local-midnight boundary is converted independently, so DST days/weeks retain their true absolute durations. Bookings and breaks overlapping the range are included, including a booking that started before midnight. Bookings sort by start instant then ID. Temporary/expired reservations remain absent from the booked agenda; completed/no-show/cancelled persisted lifecycle entries retain their original service and contact snapshots.

The repeatable-read response contains bounded-range display projections and coherent appointment/revenue totals. Revenue includes confirmed/completed snapshots, excludes no-show/cancelled, and remains separated by currency. Staff display includes current parallel capacity. Tenant predicates apply to bookings, blocks and staff; membership never grants another tenant's records. Responses inherit no-store caching.

The Expo route composes `ProviderAgenda.hook.ts` and a typed pure `ProviderAgenda.component.tsx`. API/contact operations live in a service; transient tabs/date/day-or-week/break drafts live in a scoped Zustand store. Account/context/workspace changes clear drafts and private queries. UI covers translated loading/empty/error/retry and invalid dates, daily/weekly navigation, readable local dates, staff/capacity and actionable break conflicts. Existing provider lifecycle controls retain explicit translated cancellation confirmation, current server authorization/revision checks, pending controls and persisted error behavior. No outbound messages are sent by this task; existing manual contact links only open when the user presses them and accept validated phone numbers.

## Schedule impact contract

Business and staff `POST /v1/provider/businesses/:businessId[/staff/:staffId]/availability-rules/preview` validate the same weekly/override payload as save. The transaction fences the current session, locks the business configuration and current manager membership, and reads the proposed scope against every still-occupied confirmed/completed/no-show interval and unexpired HELD interval. Existing occupied boundaries include reserved service buffers; they are not reconstructed from mutable catalog durations. Current business/staff absolute shared working windows, split intervals, override precedence, inheritance and DST rules use the same engine as booking availability.

Preview writes no schedule, booking, event, reservation or publication state. It returns an opaque SHA-256 state token, timezone, affected appointment/reservation display details, and `canSave`. Token input binds the target/proposal, business row version/timezone, ordered current business/staff rules and occupied booking states/revisions/instants. It grants no authorization and does not reserve a slot. There is no expiry countdown; any relevant state change requires another preview.

The new schedule editor always displays review before explicit final confirmation. Conflicts disable confirmation and identify protected appointments/active reservations. The provider must retain accommodating hours or resolve the appointments through authorized operations before trying again; there is no override that silently invalidates them. Dirty drafts survive request/stale-review failures. Editing a draft discards its previous preview. Successful saves reload schedules, agenda, owned booking details/history and availability/calendar queries.

`PUT …/availability-rules` accepts `X-Visit-Schedule-Preview` for optimistic review validation. While holding the business UPDATE lock it rechecks the session, recomputes impact, rejects a stale supplied token, and rejects any unsafe proposal before replacing business or staff rules. Direct internal and legacy PUTs without a preview token still undergo mandatory impact recomputation. The compatibility `/api/provider/working-hours` route forwards a supplied preview header to the same validation boundary; it cannot drop a stale-token check or bypass occupied-interval protection.

| Failure | Persisted outcome |
| --- | --- |
| `SCHEDULE_CONFLICT` | Existing hours, reservations and bookings remain intact; resolve affected allocations or change the draft. |
| `SCHEDULE_CHANGED` | No schedule write; preserve the draft and preview current state again. |
| Validation/permission/session failure | No schedule write or disclosure outside the authorized business. |
| Transaction/network failure | Transactions roll back; the client refetches/reviews instead of assuming a commit. |

## Atomicity with booking and break mutations

Configuration writes hold Business FOR UPDATE and current membership SHARE locks. Hold/confirmation/reschedule transactions take Business FOR SHARE. If a booking owns SHARE first, the editor waits and then sees that committed occupied interval before applying hours or a break. If the editor owns UPDATE first, it checks current intervals and writes the configuration before releasing the lock.

Every `withBusinessConfiguration` commit also updates the Business row version in that same transaction. This is necessary: a serializable booking reader can establish its snapshot before waiting on the business lock. A lock alone on an unchanged business row would not force a fresh snapshot after a ReadCommitted editor changed separate hour/block rows. The actual Business update causes that waiting serializable reader to fail with a structured serialization conflict; `withBookingTransaction` retries the complete transaction and checks current hours/blocks. Database rollback includes the row version and publication/readiness effects.

Break creation/deletion reuse authorized configuration transactions, fence the current session/membership and revalidate active staff. Creation rejects overlap with complete occupied booking buffers, active holds and existing breaks. Concurrent booking/edit outcomes never both invalidate capacity or silently release appointments. Redis is not authoritative for schedule editing; the PostgreSQL lock/version protocol fences competing authoritative booking writes. The existing configured publication/readiness behavior remains in force after safe edits.

## Evidence and reproducibility

Fresh test-only QA supplied API tests for local/DST boundaries, overlap and deterministic ordering, minimal projections, empty/held exclusion, business/staff preview immutability, complete buffers and active holds, direct/v1/legacy unsafe-write refusal, stale review after booking/config changes, same-token concurrent edits, real booking-versus-date-closure races, deterministic stale-Serializable-snapshot rejection, breaks, tenant/role/session denial and malformed queries. Three pure mobile tests cover copied drafts/proposals and scoped store cleanup. Eleven typed-prop schedule stories cover safe/conflicting/HELD previews, pending/loading/error/retry, dirty draft retention, staff inheritance, callbacks and long Hebrew text.

The exported-web suite covers daily/weekly navigation, loading/error/retry/empty, protected business schedule previews with no writes, active hold conflicts, stale-review rejection, pending explicit commit, declined/failed/successful provider cancellation and Hebrew RTL on mobile/desktop. Existing setup browser actions now preview and explicitly confirm business/staff hours. The prior schedule foundation test now expects rejection of closing an occupied date; the publication test expects conflicting staff edits to be refused. Original booking snapshots remain byte-for-byte intact.

Run DB-backed API and browser suites sequentially from the root:

```sh
npm run typecheck
npm run lint
NODE_ENV=test npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile
```

From `apps/api`: `../../node_modules/.bin/tsc -p tsconfig.test.json --noEmit` and `../../node_modules/.bin/prisma migrate status`.
From `apps/mobile`: `NODE_PATH=./node_modules ../../node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/vis18-native`.

Local verification: 262 API, 68 foundation and 91 Storybook tests passed, along with workspace typecheck/lint, fixture TypeScript compilation, the full exported-web regression and iOS/Android JavaScript exports. An existing expired-hold reschedule assertion returned an unexplained 409 in one earlier full run; it passed in isolation and in the final complete run. Its assertion now includes the response body for future diagnosis. Hosted head-linked CI results are recorded in Linear, the PR and local handoff. Fresh read-only Security review covered tenant/session fences, projection, tokens, row-version/lock ordering, context/draft/focus guards, phone validation and compatibility forwarding; no outstanding blocking findings. QA ran isolated pure tests/fixture compilation; developer owns integrated API/browser execution. Both agents initially hit an account usage limit, then resumed and completed their audits; no incomplete audit is claimed as passed.

No new migration is required; 29 existing migrations remain current. Existing API3000/Metro8081/8082 runtimes are preserved; test services use3001/8083. Native JavaScript exports do not establish physical-device or live-provider acceptance. Hosted account payment/spending limits must be distinguished from local checks; no billing change/admin bypass/deployment/live delivery is performed. Native/live gates remain VIS-2 →VIS-43 →VIS-25. Provider-entered appointments remain VIS-38; independent integrated/stress validation remains separate.

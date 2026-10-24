# Availability engine (VIS-16)

## Shared computation and scoped reads

`src/scheduling/availability.ts` is a pure engine with an explicit clock. The
public repository validates an issued `PublicBusinessContext`, rechecks business
approval and active service scope, then loads business/staff hours, overrides,
bookings and blocks in one repeatable-read snapshot. Relation queries batch all
assigned active resources, avoiding per-staff round trips. Every relation carries
business scope. Unassigned/inactive resources, foreign services and unapproved
businesses are not returned. No customer identity, booking ID or block reason is
included in a candidate/conflict response.

Both `/v1/businesses/:businessId/availability` and the `/api/providers/:providerId`
compatibility availability path use this repository. Results include:

- `advisory: true`, business IANA `timezone`, service identity/duration and a
  documented `slotStepMinutes: 15`.
- Per slot: staff identity/name, UTC `startsAt`/`endsAt`, UTC occupied bounds,
  local display time and explicit UTC offset, `available`, `locked`, remaining
  concurrency and stable machine-readable `reasons`.
- Schedule boundary warnings, scoped to business or staff without private data.

`includeUnavailable=true` retains candidate starts that fail notice, full-interval
containment, blocks or capacity, so the client can disable them. Default responses
contain only available slots. Entire past dates and dates beyond the local booking
horizon return no candidates. Closed intervals do not generate starts.

## Interval semantics

Working hours use the VIS-10 precedence: explicit date override replaces recurring
hours; business/staff windows intersect; staff with no recurrence inherits business
hours; a configured staff recurrence closes unspecified days. Adjacent windows are
merged before timezone resolution and intersection; a contiguous schedule boundary
is not an artificial break. Separated lunch breaks remain closed.

**The entire occupied interval, including both buffers, must fit inside the
intersection of business and staff working hours.** Buffers cannot extend into a
break, before opening or after closing. Direct hold and reschedule preflight use
this same containment function. Existing stored booking/hold snapshots are not
rewritten when settings change.

Capacity is the peak simultaneous occupancy over the entire candidate interval,
using `[start, end)` semantics. Counting overlapping database rows is insufficient:
two sequential existing appointments can each overlap one proposed appointment
without simultaneously exhausting capacity two. Adjacent occupancy is allowed.
Confirmed appointments and HELD appointments with expiry strictly after the
request clock count; expired, cancelled and completed records do not. Manual blocks
close all capacity and intersect buffers as well as service time. Cross-day blocks
and bookings are fetched when their occupied interval overlaps the business day.

`remainingCapacity` reports remaining resource concurrency across the candidate,
independently of other eligibility rules (a blocked slot may have spare capacity).
`CAPACITY_FULL` identifies exhaustion; `TEMPORARY_HOLD` means removing active holds
would free the candidate. `locked` is true only when that temporary occupancy is
the sole source of ineligibility. It does not imply a specific customer's Redis key
was inspected or reveal the owner of another reservation.

## Timezone and DST

Service durations and buffers are elapsed minutes on the UTC timeline. Local
working windows are resolved to absolute instants before containment, instead of
comparing wall-clock start/end strings. Generation advances by 15 elapsed minutes
from the intersected opening, so spring gaps never emit nonexistent local times
and fall folds emit both occurrences with different absolute instants and offsets.
Long services are allowed when their actual elapsed interval fits, even if simple
wall-clock duration arithmetic would exclude them.

Actual opening/closing boundaries must resolve uniquely. If a weekly boundary is
nonexistent or ambiguous on a transition day, **that interval is skipped** with
`NONEXISTENT_SCHEDULE_BOUNDARY` or `AMBIGUOUS_SCHEDULE_BOUNDARY`. No implicit shift
or fold choice is invented. Use an explicit date override with unambiguous opening
and closing boundaries; the present override contract has no offset/fold field.
A continuous adjacent union is normalized first, so an internal redundant boundary
at a clock change does not incorrectly close an otherwise valid continuous window.
Overnight hours remain outside the current same-day schedule contract.

The booking UI groups repeated local times by staff and displays `UTC+/-offset` on
both occurrences so the user can distinguish them. Selection keys always use
staff plus absolute start. Locale does not affect eligibility or stored instants.

## Advisory results and production integration

A read snapshot grants no reservation. PostgreSQL's VIS-5 capacity trigger is the
atomic capacity authority for hold insertion, confirmation/status transitions,
rescheduling and raw writes; Redis coordinates contenders but is not the only
capacity guard. Stale/expired holds cannot be confirmed into occupied capacity.
VIS-26 still owns transactional revalidation of **all current** publication,
contact, schedule, policy and hold-ownership conditions at confirmation; preflight
checks here do not certify that larger integration.

The current schema has approval without the publication lifecycle. VIS-34 adds
published-only discovery/availability/new-booking eligibility across these reads
and public tenant context, while preserving authorized draft setup access. This
availability engine does **not** claim approval alone is production publication.
Service names/durations/prices on existing bookings remain the immutable VIS-12
snapshots; availability for a new booking uses the current active catalog.

## Reproduction

- `npm test --workspace @visit/api`: pure buffers/splits/adjacency/capacity/expiry/
  blocks/notice/horizon matrix; New York and Jerusalem spring/fall transitions;
  scoped repository and compatibility parity; staff recurrence/overrides; direct
  hold/reschedule buffer rejection and stale-confirmation rejection. Existing
  PostgreSQL concurrency guard and tenant-isolation suites remain enabled.
- `npm run test:foundation --workspace @visit/mobile`: repeated clock label tests.
- `npm run test-storybook --workspace @visit/mobile`: distinct repeated-clock
  offset selection plus existing component/axe regressions.
- `npm run test:web --workspace @visit/mobile`: real API/Redis/PostgreSQL booking,
  parallel contexts, catalog, provider agenda and authentication regressions. A
  synthetic New York fall-fold fixture also locks and confirms the second 01:30
  occurrence and checks the persisted UTC instant through the actual API/Redis/DB.
- `node apps/api/scripts/infra-smoke.mjs --api-tests`: isolated fresh migrations,
  committed-source API image/test run, outages/recovery and cleanup.

Native bundle exports validate imports; installed native interaction, live-provider
behavior and prolonged concurrency/load/failover remain their dedicated issues.

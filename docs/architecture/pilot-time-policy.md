# Israeli-time pilot policy — VIS-47

## Scope and storage

New pilot businesses use `Asia/Jerusalem` from the shared `PILOT_TIMEZONE` contract. Provider application accepts that exact IANA name or omission (server default); other zones/aliases are rejected before writing a business. Account setup shows the fixed value and explains it in Hebrew/English. Device timezone and UI language cannot select a business timezone.

The generic availability engine remains multi-zone. Recurrence/override dates and local hours use the stored business zone. Booking starts/ends/occupied bounds remain absolute UTC instants. No fixed UTC+2/+3 arithmetic determines Israeli local time. Existing DST boundary validation still rejects nonexistent starts and ambiguous schedule boundaries, emits both valid fallback instants, and revalidates capacity on the absolute timeline.

Customer booking, provider agenda, confirmation and active appointment rendering use the business zone explicitly. Israeli pages explain local Israeli time once; traveler device location does not change it. Slot cards omit repetitive timezone identifiers. Repeated clock times say first/second occurrence in Hebrew/English and retain staff + exact startsAt as selection identity. Confirmation and agenda can independently identify a repeated Israeli hour after reloading, even without the original availability list. Technical offsets remain in API availability data for exact disambiguation, not on every card. Existing non-Israel businesses keep a truthful legacy-zone notice.

`appointmentTime`'s independent fold annotation compares instants one elapsed hour apart, matching Israeli transitions. It does not claim complete historical worldwide half-hour/multi-hour fold annotation; the generic engine still returns those distinct instants/offsets. Calendar export retains UTC `DTSTART`/`DTEND` ending in `Z`, plus the stored business timezone metadata. Device calendar software may display its chosen viewing zone without changing the event instant.

## Rollout inventory: no migration applied

Read-only local aggregate inventory on 2026-10-25 at 08:57 UTC found:

| Existing zone | Approval | Businesses | Bookings |
| --- | --- | ---: | --- |
| UTC | Approved | 6 | 3 confirmed, 1 cancelled |

These records were preserved. Aggregate labels do not prove the data is disposable. Do not relabel those businesses or rewrite any appointment automatically. A real non-Israel business needs a reviewed timezone/schedule migration decision, including future recurrence, confirmed appointments and customer communications, before being admitted to Israeli-only pilot publishing. No such migration or communication is authorized by this change.

Run the inventory from `apps/api`: `../../node_modules/.bin/tsx scripts/timezone-inventory.ts`. It uses a read-only repeatable-read transaction and emits only aggregate zone/status counts, no identity/contact/business identifiers. Synthetic engine/browser fixtures may deliberately retain other zones to prevent generic engine regressions.

## Downstream API contracts and ownership

- **VIS-34 publishing:** readiness must require stored timezone exactly `PILOT_TIMEZONE`; non-pilot legacy businesses fail readiness with an actionable migration-review reason. Do not rewrite timezone on publish, approval or profile reads.
- **VIS-35 setup:** display the fixed pilot timezone with localized explanation. Hours and override dates are local business values; changing device location/language never changes saved rules. Timezone migration is a separate operation, outside setup editing.
- **VIS-24 nearby-time/calendar/review:** preference and chosen calendar date are local business values; default today uses the business zone. Nearby slots sort by startsAt, preserving fold identity and truthful first/second labels even if only a subset is visible. Final review uses the exact selected UTC instant and local display. The compact calendar and nearby-time controls are implemented in VIS-24; see compact-booking.md.
- **VIS-26 confirmation:** accept the exact UTC instant/staff/service IDs from server availability, never reconstruct it from a wall-clock label or client timezone. Revalidate published/pilot readiness atomically; no client offset is authorization or capacity proof. Current early-hold behavior remains until VIS-26.
- **VIS-28 success/VIS-14 lifecycle:** read persisted UTC startsAt and stored business timezone; include traveler devices, DST fold selection, midnight dates and ICS instant assertions. Do not infer success from a client-only selection.

## Evidence and remaining limits

API regression tests enforce new-business timezone rejection/default and cover Jerusalem spring/fall gaps, fold choices, recurrence, tenant boundaries and preserved booking snapshots. Mobile unit tests cover midnight, spring jump, both fall occurrences, English/Hebrew, traveler runtime zones, legacy label ordering and exact ICS timestamps. Browser regression extends the existing New York fold test with Jerusalem, locks/confirms the second occurrence, checks its persisted UTC instant and the confirmation under an America/Los_Angeles device timezone. Storybook verifies cards omit technical timezone labels and fold choices remain separately selectable.

Actual installed native behavior and real calendar-app imports remain pilot device checks. Future compact review/publishing integrations must consume this contract in their own implementation; this issue does not claim those screens/workflows already exist.

References: [IANA Asia time-zone data](https://data.iana.org/time-zones/tzdb/asia), [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat).

Local validation on 2026-10-25: 128/128 API tests; 25/25 mobile foundation tests; 47/47 Storybook tests; full browser suite (including both New York/Jerusalem folds); root typecheck and lint passed. Both native bundle exports succeeded. No installed-device execution or deployment occurred.

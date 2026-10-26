# Compact booking — VIS-24

The booking screen uses a compact service selector, calendar sheet and preferred local-time input. A sole active service is selected automatically; zero services disable date selection. The service summary retains its duration and price. Only actual, available, unlocked candidates appear in groups of at most six, ordered by absolute instant and staff identity. Earlier/Later changes the group, while a valid HH:mm preference positions it near the requested clock time. A preference never creates or reserves a candidate.

The calendar calls `GET /api/providers/:providerId/booking-calendar?serviceId=…&fromDate=YYYY-MM-DD&days=31`. Strict validation limits each request to 1–31 days. A single repeatable-read snapshot loads tenant-scoped occupancy and rules, then uses the same availability generator as daily slots. Responses contain only dates and availability booleans, timezone, today and the policy maximum date. Closed overrides, staff availability/capacity, blocks, active holds, booking horizon and minimum notice all affect selectable dates. An explicit next-date action searches bounded batches within that policy; it selects a date, never a time.

Owned rescheduling uses `/api/bookings/:bookingId/booking-calendar`. Authentication, current ownership/status and cutoff are checked; the service and historical duration come from the booking. Private archived services and unpublished approved businesses retain their existing owned-reschedule behavior. Public eligibility is rechecked in the snapshot. Query parameters cannot substitute a private service.

Business-local dates and time formatting preserve the VIS-47 policy: Israeli pilot businesses use Asia/Jerusalem; historical UTC and other-zone businesses retain their actual zone. Device timezone does not change an appointment instant. Fold labels are calculated from the full candidate array before filtering/paging, so first/second occurrence remains truthful when only one appears in a group. One friendly business-time note replaces repeated zone identifiers.

Selections are scoped to provider, service and date. Switching those values clears incompatible selection. Calendar requests have independent query keys; explicit date searches use abort and sequence guards. A fresh slot response clears and announces a selection that became unavailable. Conflict recovery removes the stale time and refreshes availability without selecting a substitute.

Selection and review remain advisory. VIS-36 contact readiness and VIS-26 final-consent/idempotent commit are reused. Review retains the exact business/service/staff, local date/time, duration/price and cancellation policy. Only explicit final consent can reserve and persist. No new delivery integration or deployment is included.

## Verification

Validated on 2026-10-26: **208 API, 51 foundation and 60 Storybook tests pass**, alongside the complete exported-web journey, workspace typecheck/lint, API fixture compilation, 25 applied migrations, and iOS/Android JavaScript exports. Automated JavaScript exports do not establish native/device acceptance; VIS-2 → VIS-43 → VIS-25 remains the native/live-provider gate.

- API: calendar integration tests cover strict bounds, public eligibility, tenant isolation, no writes/private leakage, schedule/notice/horizon/blocks, and authenticated owned archived-service access.
- Foundation: date arithmetic, calendar grids, available candidate filtering, exact staff/instant identity, nearest-time pages, DST labels and immutable inputs.
- Component: interactive available/loading/empty/error/no-service states with Storybook accessibility checks.
- Browser: real local database fixtures exercise Hebrew RTL/Escape, traveler timezone, closed-date disablement, next-date search, preference/paging/invalid time and calendar retry. Existing full journeys retain contact verification, advisory review, concurrency conflicts, DST folds, commit recovery and ownership checks.
- Independent QA added edge-case unit coverage and found no confirmed production defect; Security reviewed tenant/auth/input/response/async/consent boundaries with no concrete introduced vulnerability. Their reviews did not claim device or live-delivery evidence.

Independent QA: fresh `/root/vis24_qa` session added seven edge-case tests, including December 9999, and verified mobile typecheck/lint and 51 foundation tests. Security: fresh `/root/vis24_security` session reviewed the full implementation and final delta statically; no concrete introduced vulnerabilities or outstanding action items were found. Neither audit represented a native or live-provider run.

## Commit and hosted check evidence

Implementation: `f66da2d1ff845f014da13266bcd8ade996ae94c3`. PR: https://github.com/barakfisher/Visit/pull/12.

GitHub Actions run `40374623965`, job `121754179248` on the implementation commit completed with failure and **zero steps**. Its annotation states that recent account payments failed or the spending limit must be increased. This is an account billing gate; hosted CI is not claimed to pass. Local checks above and independent audits are the available execution evidence. No billing change or bypass was performed.

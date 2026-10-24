# Working hours and booking policy (VIS-10)

## Calendar model and precedence

Business timezone is a validated IANA zone. Weekly rules contain weekday (Sunday=0), and up to eight same-day opening intervals. Unspecified business days are closed. Multiple separated or adjacent intervals are supported; overlaps, duplicate weekdays and reversed/malformed intervals are rejected with field paths. Current boundaries use `00:00`–`23:59`; overnight shifts must be represented as separate calendar days. The API does not accept `24:00`.

One explicit date override replaces the business recurrence for that date. A closed override has no hours; an open override supplies one increasing interval. Duplicate dates and impossible dates are rejected. Split date overrides are not supported by the current payload. Staff date overrides take precedence over staff recurrence; business and staff windows intersect, so staff cannot open a closed business. With no staff weekly rows, staff inherits business hours; an empty staff weekly payload resets to inheritance. Once any staff recurrence exists, its unspecified days are closed. Explicit closed staff overrides close individual dates.

`rules.ts` supplies shared validation at the repository boundary, covering both modern and compatibility HTTP routes and internal callers. Full schedule replacement serializes on the business row so concurrent writes cannot merge two independently valid schedules into overlapping rules. Business and staff IDs come from validated tenant context.

## DST and storage

Bookings are absolute UTC instants; recurrence and override hours are local wall-clock values interpreted in the business zone. A booking's service duration is elapsed minutes. Spring-forward nonexistent starts are rejected. Fall-back ambiguous booking starts require an explicit matching UTC offset. `possibleLocalInstants` exposes both candidates for consumer selection. New York and Jerusalem spring/fall transitions are covered by automated tests.

Date-override boundaries must each resolve to one instant. Nonexistent and ambiguous boundaries are rejected with actionable field errors. The present override format has no offset field; choose an unambiguous boundary around a clock change. Weekly rules remain wall-clock recurrence; VIS-16 owns the full candidate engine and transition-day containment/buffer edge cases. This contract does not claim those engine cases are already complete.

## Explicit configurable defaults

Recommended onboarding prefill:

| Setting | Prefill | Accepted range |
| --- | ---: | ---: |
| Minimum notice | 60 minutes | 0–525,600 minutes |
| Maximum advance | 60 local calendar days | 1–730 days |
| Buffer before / after | 0 / 0 minutes | 0–1,440 each |
| Customer cancellation cutoff | 1,440 minutes | 0–525,600 minutes |
| Customer rescheduling cutoff | 1,440 minutes | 0–525,600 minutes |

`GET .../booking-policy` returns `defaults` separately from `policy`. Defaults are a prefill, never an implicitly active policy. A provider must save all six values explicitly; missing policy continues to prevent booking. Minimum notice cannot exceed the maximum horizon. Unknown properties and invalid/fractional/out-of-range values are rejected. Each business remains free to choose its own values.

Notice and cutoffs compare elapsed minutes to the appointment's start; equality is allowed and values below the threshold are rejected. Maximum advance uses the business's local calendar date, inclusive through that date. Buffers extend the half-open occupied interval for capacity checks. VIS-16/VIS-26 own complete availability and authoritative hold/confirm enforcement; VIS-30 owns customer cancellation/rescheduling enforcement.

## Changing settings with existing bookings

Schedule and policy edits affect future eligibility. They never silently cancel, move, rewrite occupied intervals, or reinterpret existing appointment UTC instants. Tests verify confirmed and held booking snapshots remain unchanged after a closing override, while fresh availability becomes empty. Policy changes likewise leave existing stored snapshots intact.

An active hold is provisional: preserving its record is not a promise it can still be confirmed. VIS-26 must revalidate current settings atomically at confirmation and release/expire invalid holds. VIS-18 owns provider conflict review/warnings and explicit appointment operations for affected confirmed appointments. No notification or cancellation is implicitly sent by these repository saves.

## Evidence

Run `npm test --workspace @visit/api` for schema validation, precedence, both DST zones, tenant-safe internal/HTTP writes, concurrent full replacements, explicit policy defaults, unchanged booking snapshots and closed-date availability. Run `npm run test:web --workspace @visit/mobile` for exported browser regressions, then typecheck and lint. Commit-linked clean-database evidence is recorded in Linear.

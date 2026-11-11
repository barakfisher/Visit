# Visit handoff — 2026-11-11, business forms as sheets with pickers

PR #60, built on `main` after PR #59. Read `2026-11-11-business-day-cards.md` first; its lessons hold.

## Authorization

The user's global working agreement governs. The user reviewed customer Home and both business forms on Android and listed ten changes. They chose free slots "like a customer" over a clock picker for Add appointment, and dropping the unverified-contact reason on the server, not only in the app.

## Where things stand

- **Customer Home:** provider cards are back to their pre-#59 look (archive box, 12px padding) and are all three lines tall: name on one line, details on up to two.
- **Add appointment is a bottom sheet over the business home** (`ManualBookingDialog`); the `/provider/[businessId]/add` route is gone. Service, date and time use the customer's controls and free slots; with several staff, chips narrow the times. Only name, phone (typed the local way) and optional email are typed.
- **No exception reason anywhere.** `exceptionReason` is rejected by the API, `requiresException` is gone from the options, and migration `20261111120000_manual_without_exception_reason` drops the trigger's reason check. The audit reason still says whether the verified-contact policy was on.
- **Block time picks its dates and times** (`DatePickerField`, `TimePickerField`): a month grid from today, and hour plus 5-minute grids. Choosing a first day after the last day moves the last day.

Reasoning: `docs/architecture/decisions.md`, the two sections dated 2026-11-11 at the end.

## Lessons (these will recur if forgotten)

- **A sheet stacked on a sheet loses its dialog role on web until the top one closes.** React Native Web keeps `aria-modal` on a non-top `Modal` but drops `role="dialog"`, which axe reports. Stories that open a picker wait for one `aria-modal` before their play ends.
- **The pickers open on the month of their value, not today.** A story or smoke looking for a day in another month steps with Next month (`scripts/pickers.ts`).
- **A free slot carries its UTC offset; send it.** It is what makes a repeated daylight-saving hour unambiguous now that nobody types an offset.
- **Free cards prefill time and staff, not service.** The time is chosen once a service is picked and that slot is free; otherwise nothing is chosen and Review says so.
- **A worktree's `node_modules` can lag `main` (again):** `npm run test:web` failed to bundle until `npm install`.

## Debt worth knowing

- **Stacked sheets were checked in the browser only.** Two React Native `Modal`s at once is normal on iOS and Android, but nobody has opened a picker on a phone yet.
- **No native date/time picker.** `@react-native-community/datetimepicker` was set aside because it has no web version; the user has not decided whether phones should get the system look.
- **Save the customer and invite them to the app (the user's item 8) is not built.** Linking a hand-entered customer to an account by phone is safe only once phone numbers are verified; until then a typed number proves nothing about who owns it.
- `apps/mobile/.expo/types/router.d.ts` in this worktree was stale (October), so `tsc` reported route-type errors that Expo regenerates on start. Not a code error.

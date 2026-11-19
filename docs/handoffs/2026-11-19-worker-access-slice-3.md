# Visit handoff — 2026-11-19, worker access slice 3 (My day for a worker) (PR #73)

Built on `main` after PR #72. Decisions: `decisions.md`, "My day for a worker".

## Authorization

The user's global working agreement governs. The parent session asked for slice 3 and to ask before committing or opening a PR. The user answered two design questions: only the owner links calendars, and a worker reads only what booking on their own row needs. Owner calendar option A was decided before this session.

## Where things stand

- A STAFF membership linked to a non-archived staff row gets provider mode for that business. Home is **My day** ("היום שלי · {row} · {business}"): their own agenda by day, and the calendar by day, three days or week. The footer has Home, Calendar and Add; no Team, no Business settings.
- On their own row a worker adds, cancels, blocks time, releases their own blocks and marks outcomes, and searches every customer card of the business. Another row is 404 at every endpoint.
- A business-wide block shows read-only. A row marked unavailable shows existing appointments, a "new bookings are off" note, and hides Add and Block.
- Only the owner links a calendar. A manager's Roster card says so instead of offering a calendar invite.
- Slice 4 (worker notifications) is next. Read "Open before slice 4" in worker-access.md first.

## Lessons

- **Every calendar action goes through `requireCalendarScope`.** It returns `{context, staffId|null}`; filter with `onCalendar(scope)` and `blocksSeenBy(scope)`, and recheck with `calendarMembershipWhere(scope)` inside the write transaction. A new calendar route that calls `requireBusinessPermission` directly will either refuse workers or leak other rows.
- **The manual-booking trigger also authorizes.** `visit_booking_contact_guard` checked OWNER/MANAGER itself, so the API allowed a worker and the database answered 500 (`VISIT_MANUAL_BOOKING_AUTHORIZATION`). Any role change for bookings needs a matching trigger migration; the new one is a copy with only the membership check changed.
- **A 403 under `/v1/provider/businesses/*` or `/api/provider/*` drops the app to customer mode** (`onProviderForbidden`). Worker screens must never call a setup read; that is why the dashboard skips the readiness read and the footer skips its readiness check for a worker.
- **Public availability lists every staff member.** The add sheet must filter slots to the rows `manual-booking-options` returns; the browser check caught a worker being offered a colleague's times (the server would have refused the booking).
- **Cleanup in tests must delete `BusinessAccessEvent` rows before the business**, or the foreign key blocks the delete.
- **The worktree used database `visit_slice3`** and browser checks ran on 127.0.0.1 ports 3006/8086.

## Not verified

- **Checked:** API full suite 448/448 (`worker-my-day.test.ts` 17 tests: profile and `/v1/me`, day and week scoped with business-wide blocks, empty day, history, options narrowed, add own row and refused on another row, database guard on another row, card search and existing card, move, outcomes, cancel, blocks, closed setup reads, unavailable row, relink, removed worker back in customer mode; permission matrix with one refused write per permission); API typecheck clean; mobile typecheck, lint, foundation 234/234. Browser pane at 375px in Hebrew RTL against a real API as the worker: My day, week and day calendar, empty day, add sheet with only the row's service and slots, card search, block create and release, business-wide block read-only, unavailable-row note, app-level read failure with retry, no 403 in the network log.
- **Reviews:** `bf-qa` found no blocker; its finding that the relink check had no test was fixed (the test now relinks and fails if the check is removed), and the card-exists code is asserted by its constant. `bf-security-reviewer` confirmed all eight claims and found no vulnerability; its L1 (the card permission was not rechecked inside the booking transaction) is fixed. Not checked by it at runtime: a revoke racing a waiting manual booking.
- **Not checked:** a worker opening a setup URL directly (`/provider/{id}`, hours): the 403 may drop provider mode until the next profile read; the footer's Add follows the cached profile, so a row marked unavailable mid-session still shows Add until it reloads (the server refuses with 404); no stories or UI tests for the worker screens, so they rest on the browser check above; English layout in the browser (strings exist in `workerMessages.ts`); the agenda's own read-failure card for a worker (the API was down, so the app-level account error showed first); native iOS/Android; a manager's Roster in the browser (covered by the `ManagerLinksNoCalendar` story).

## Debt

- **Live signals are business-wide.** A worker learns *when* another row changed (no data; every refetch is scoped). A per-row topic would close it.
- **A worker's block runs the whole-business configuration step** (`publication.ts`): it briefly locks the business row and, if the business is already not ready to publish, unpublishes it and expires holds, as an owner's block does. A row-only path for workers is open.
- **The trigger guards manual-booking inserts only;** move, cancel and outcome row rules are enforced by the app alone, as for managers before.
- **Booking history returns `oldStaffId`/`newStaffId`,** so a booking moved onto a worker's row shows the other row's id (no name).

- **No provider UI to move an appointment**, for owners either; a worker moves one only through the API.
- **A manager's calendar invitation made before this PR now fails at accept** (`INVITATION_UNAVAILABLE`). The owner must send a new one.
- **`AgendaAppointmentCard.stories.tsx` "Manual Without Phone" flakes** on axe colour contrast (text caught mid-fade, #fdfefe on white): 1 failure in the full storybook run (269/270) and 1 in 3 runs alone. The component is unchanged in this PR.
- `tsconfig.test.json` typecheck is still red on `main` at `test/booking-operations.test.ts:140` (unchanged).

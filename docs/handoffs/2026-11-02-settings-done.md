# Visit handoff — 2026-11-02, business-settings redesign done

Supersedes `2026-11-02-settings.md` for current state. The redesign milestone (the user's ten comments, agreed as four tasks) is finished. Read `2026-11-02-mvp.md` next: its decisions, lessons, local-run notes, debt and suggested order still hold unless corrected below.

## Authorization

The user's global working agreement governs. Every merge in this period (#29–#34) was an explicit instruction, and the `main` ruleset needs `gh pr merge --admin` even with green CI. This handoff PR was opened and merged on the user's request ("merge handoff and start a new session"). None of these is a standing grant.

## Where things stand

`main` is at `0752627` (PR #34) plus this handoff. Merged since `2026-11-02-settings.md`:

| PR | What | Decision log entry (2026-11-02) |
|---|---|---|
| #29 | Settings hub, one screen per section | "Business settings hub with one screen per section" |
| #30 | The settings handoff | — |
| #31 | Services in a dialog, one Delete, ILS only; policy in hours with plain names | "Services and booking policy settings" |
| #32 | Weekly hours as a grouped summary with an edit dialog | "Weekly hours summary and edit dialog" |
| #33 | Time blocks with a reason, replacing date overrides (migration drops `ScheduleOverride`) | "Time blocks with a reason" |
| #34 | Staff: removal (delete / archive / refuse), one Edit with General and Hours tabs, service chips, digits-only capacity | "Staff settings: removal, one Edit, hours tab" |

Hosted CI passed on #29, #31, #32 and #34 before merging (#33 per its own session; not rechecked here). The VIS items and everything in the MVP handoff's table are unchanged.

**The `home-screen-design-ea348f` worktree is now clean** (detached at `8f4957c`, no uncommitted changes). The provider-setup work the MVP handoff called "in flight" there either landed through #29 or was dropped; ask the user before deleting that worktree. Other finished worktrees from this milestone (`business-settings-redesign-87bc7a`, `services-policy-redesign-b524cb`, `hours-redesign-1a1458`, `magical-einstein-833ea5`, this one) can be cleaned up when the user agrees.

## Decisions since the last handoff

All in `docs/architecture/decisions.md` with rejected alternatives; the table above names each entry. The ones a stranger would most likely re-litigate:
- **Removing staff never cancels appointments,** and a block never covers them. Both are refused with the affected appointments listed (`STAFF_HAS_APPOINTMENTS`, `BLOCK_CONFLICT`), because there is no email delivery to tell customers. Revisit both once email exists.
- **Archived staff (`Staff.archivedAt`) cannot be restored;** the owner adds them again. Archiving is how history survives the restrictive booking foreign key, the same pattern as services.
- **An empty staff week means "follow the business"** in the API, so the UI refuses a staff week closed on every day. Pausing a person is the "Available for new appointments" switch, not their hours.

## Lessons (these will recur if forgotten)

- **Storybook cannot bundle `expo-router`, `expo-crypto` or `react-native-svg`.** A view that needs one gets it injected by its screen (`StaffRoster.tsx` passes the Hours tab and `randomUUID` into `StaffRoster.component.tsx`). Icons are drawn with `View`s (`AddButton`, `EditButton`).
- **A smoke that closes a weekday for the only staff member breaks `booking-resilience-smoke`,** which books on consecutive dates and expects exactly one closed date. The setup journey stores its one closed date as a whole-day time block.
- **The browser suite exports the web app once, at its start.** Changes made while it runs are not in that run; rerun it after the last edit.
- **`booking-guard.test.ts:116` ("reschedule can reuse capacity from an expired hold") failed once in a full API run** with 409 "Availability changed" and passed 5/5 alone and on the next full run. That code was untouched; it looks like a flake under `--test-concurrency=2`. Note it if it recurs, rather than rerunning until green.
- **The security reviewer found real low gaps in "invisible everywhere" claims:** a check made before the configuration lock (service create with `staffIds`) and a route that listed all staff without the new filter (schedule preview). When adding a state like `archivedAt`, grep every `tx.staff`/`prisma.staff` query, not only the obvious routes.

## Running locally

Unchanged from `2026-11-02-mvp.md` and `2026-11-02-settings.md`. The test database needs `npx prisma migrate deploy` with the `visit_test` `DATABASE_URL` after #33 and #34 (two new migrations).

## Debt and its consequences

- **No test runs staff removal concurrently with a booking.** The reviewer concluded from Postgres locking (removal holds the business row `FOR UPDATE`; every booking writer takes it `FOR SHARE` in a Serializable transaction) that they serialise. A regression there would let a booking land on an archived staff member.
- **Staff create and update do not fence a revoked session** (`fenceScheduleSession`); removal, hours and blocks do. A session revoked mid-request can still create or edit staff.
- **English desktop of the staff screen was checked only in Storybook,** not in the running app.
- **Conflict counts are not pluralised** ("1 upcoming appointments"), in staff, blocks and hours alike.
- **Debt from `2026-11-02-settings.md` still applies:** no API test has a Staff member call `GET /publication`; `/provider/dashboard/share` and `/provider/team/profile` pass the return allowlist; unused `setup.draft`/`setup.published` copy keys.
- **Everything under "Debt" in `2026-11-02-mvp.md` still applies,** including the MVP sign-in items to finish before the MVP ends.

## Suggested order

Agree the order with the user first.

1. **The manual end-to-end run with real accounts** (MVP handoff item 1), now on the redesigned settings: customer and provider sign-up, administrator approval, setup through every settings screen, publication, booking, agenda. Record what breaks, then decide what to fix.
2. **Clean up the finished worktrees,** with the user's OK.
3. **Return to the MVP handoff's order from item 3:** VIS-14 slice (c), the copy findings, VIS-11, VIS-20 then VIS-17, VIS-7, the native gate, and the MVP sign-in items.

One branch off `main` at a time; no stacked PRs. Next handoff: after five more merged PRs or a milestone boundary.

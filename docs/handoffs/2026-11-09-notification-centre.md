# Visit handoff — 2026-11-09, notification centre

Supersedes `2026-11-08-ui-review.md` and `2026-11-08-live-updates.md` for current state. Their lessons and debt still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user approved the scope and asked to build. Committing, opening a PR and merging each need the user's instruction, and the `main` ruleset needs `gh pr merge --admin` even when CI is green.

## Where things stand

The bell, the page and the inbox are built as `docs/architecture/notifications.md` describes, and the Home card `BusinessSetupNotice` is gone. Reasons are in `decisions.md`, "Notification centre built — 2026-11-09".

**Next item: booking slot availability**, which still polls every 2 seconds. The user put the centre first and agreed to discuss slots before building. A sibling session was started for that discussion.

## What has and has not been seen

Web, in Chromium, against a copy of the local data. Hebrew at 390 px: states, live update, navigation, access loss, reopening, a failed count re-read, and a rejection opening its reason. With unread items, Hebrew at 320 px and English at 390 and 320 px: header geometry, the circle's corner and the page. The script is not committed, so none of this guards against a regression.

No device has opened any of this. `NotificationBell` places its circle with the logical `end` offset, which measured correctly on web in both directions. React Native Web has misled here before (`ModeSwitch`), and native has not been run. Open the page on Android before trusting it.

## Lessons (these will recur if forgotten)

- **Check the header in the longest language with the worst state, at 320 px.** The bell overlapped the app name only in English at 320 px; Hebrew passed.
- **The independent QA pass found what a green browser run did not:** the page re-highlighting on reopening, a stale circle after a failed re-read, and a count that could stick at the 50-row limit. Run it on the finished slice, not only the security review.
- **Storybook's accessibility check caught what the browser run did not.** A custom row label left the visible time out of the button's name, and grey time text fell below contrast on the highlighted background. The row now has no custom label, so its name is its text. A bell label must include what the circle shows, so it says "99+", not the exact count.
- **`expo start` from a worktree needs `NODE_PATH=./node_modules`,** as `test:web` already does, or it dies on `expo-router/internal/testing`. The first web request can take 45 s on the dev server.
- **Use your own databases in a worktree.** A new migration applied to the shared `visit` database leaves the other checkouts with a migration they do not have. `pg_dump visit | psql` into a private database also tests the migration's backfill against real rows, which is how the two backfilled approvals were seen.
- **Direct `booking.create` in a test passes through guards.** Without a `BookingPolicy` it fails on `VISIT_CUSTOMER_CONTACT_REQUIRED`, and a manual row needs a `ManualBookingAttempt`, a session setting and a 64-hex fingerprint. The helpers in `apps/api/test/notifications.test.ts` do all of it.

## Debt

- **Back from an agenda opened by a notification returns to today** when an agenda was already in the stack (seen on web), because opening uses `replace`.
- **The migration's approval backfill has no committed test.** It was seen once on a copy of real rows. The hook's timing logic (first read marks, race on the count) is only partly unit-tested; the rest was checked by the uncommitted browser run.
- **Revoking a membership does not signal the revoked person.** Their bell shows the old count until their next screen change or return to the foreground; rows are refused from the next read.
- **`authProfile` does not filter deleted businesses.** This predates the work, and no path sets `deletedAt` yet. The inbox itself does filter them.
- **`prisma migrate diff` reports old drift** (several foreign keys) unrelated to this table. It predates this work.
- The rest is in the decision log entry and the gaps table in `notifications.md`.

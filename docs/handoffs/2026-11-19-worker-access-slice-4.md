# Visit handoff — 2026-11-19, worker access slice 4 (worker notifications) (PR #74)

Built on `main` after PR #73. Decisions: `decisions.md`, "Worker notifications".

## Authorization

The user's global working agreement governs. The parent session asked for slice 4 and to ask before committing or opening a PR. The user answered two design questions: a worker gets booking, move and cancellation only (no outcomes), and a move between rows tells both workers.

## Where things stand

- A booking, move or cancellation on a linked, live staff row also notifies that row's worker. Owners and managers still get all five kinds. A move between rows tells both workers.
- One row per person per event: a worker who is the customer gets it as the customer; a person with an owner or manager role and a linked membership gets one row.
- The worker's bell lists only their row's notifications and only while they are still linked to it.
- Slice 5 (switches) is next. The trigger and the read rule key on the link (`staffId`), not on the STAFF role, so switches should not need to change them; the read rule's kind list is `WORKER_NOTIFICATION_KINDS` in `Notifications.service.ts`, and the trigger repeats it in SQL.

## Lessons

- **Notification recipients live in a database trigger** (`visit_notify_booking_event`, latest in migration `20261119180000_worker_notifications`). Changing who is told means a new migration that copies the whole function; the read rule in `Notifications.service.ts` must change with it, or rows are written that nobody can read (or the reverse).
- **The read rule is the real guard.** It rechecks the link, the row's archive state and the kind on every read, so a stale or planted row never shows. Tests plant rows on purpose to prove it.
- **Signing in to the web app in the browser pane needs a password credential**; a session cookie set by script is cleared by the app's refresh flow. The seed for the browser check created a test password with `hashPassword`.
- **The worktree used database `visit_slice4`**; browser checks ran on 127.0.0.1 ports 3007 (API) and 8087 (web).

## Not verified

- **Checked:** API full suite 466/466 (`worker-notifications.test.ts`, 18 tests: booking, cancellation, move between rows and within a row, outcomes not sent, one row per person for an owner with a linked membership, a linked manager and a worker who is the customer, removed/unlinked/archived-row and pending workers get nothing, the actor is not told, a customer's own move and cancel reach the worker, the API path where the owner books and moves and a colleague cancels, the inbox hiding another row, outcomes and approvals, hiding after revoke/unlink/relink/archive and for a deleted or unapproved business, a second business where the worker is unlinked, mark-read never marking a hidden row, the trigger's SQL kind list equal to `WORKER_NOTIFICATION_KINDS`, and the bell wake); `notifications.test.ts` unchanged and passing; API typecheck clean (test typecheck has only the known `booking-operations.test.ts:140`). Browser pane at 375px in Hebrew RTL as the worker: the notification centre listed exactly their five expected rows (bookings, the move with its previous time, the cancellation), none from a colleague's row and no outcome; opening one went to My day with no 403.
- **Reviews:** `bf-security-reviewer` confirmed all six claims (other rows, removed/unlinked/archived, kinds, one row per person, trigger `search_path`, mark-read) and found no vulnerability; its suggestions are applied: mark-read's "older than" lookup now uses the read rule too, a test proves naming a hidden row does not mark it, and `proconfig` was checked in the database. `bf-qa` found no blocker; the five missing states it listed are now tested, and its weak kind assertion is fixed. Not tested: that a revoked or archived-row worker gets no bell wake (a wake carries no data).
- **Not checked:** native iOS/Android; English layout; a manager's bell in the browser (unchanged code path, covered by tests).

## Debt

- **Opening a business notification lands on today**, for owners too: the business home shows today only (decisions.md, 2026-11-10) and ignores the `date` the notification passes. notifications.md says the agenda opens on the right day; it no longer does.
- **Every linked worker's bell wakes on any appointment change in the business.** No data leaks; each worker re-reads. A per-row topic would close it, with the agenda signal.
- **The old row's worker sees the new time and customer name of an appointment moved off their row** (the user's call); the row it moved to is not named.
- **The read rule is two queries** (the reader's linked rows, then notifications), so a revoke landing between them can show one more read.

# Visit handoff — 2026-11-19, worker access slice 5 (switches) (PR #77)

Built on `main` after PR #75. Decisions: `decisions.md`, "Switches". This closes worker access's build plan (worker-access.md).

## Authorization

The user's global working agreement governs. The parent session asked for slice 5 and to ask before committing or opening a PR. The user answered five design questions:
- **Data shape:** owner or member, with four columns.
- **Owner's switches:** the owner always holds all four, enforced by the database.
- **"Act" and "see":** act requires see.
- **No calendar:** a member without a calendar counts only with "see".
- **Invitations to members:** an invitation to an active member only links a calendar.

They also chose to fix the "see without act" screens in this PR rather than leave them as debt.

## Where things stand

- **Membership:**
  - One row per person per business: `role` is OWNER or MEMBER, plus `seeAllCalendars`, `actOnAllCalendars`, `businessSetup`, `manageTeam`.
  - MANAGER and STAFF survive only as invitation preset names (`MEMBER_PRESETS`).
- **Permission checks:** every check reads the switches through `memberHas` / `permissionWhere` / `permissionSql` (`security/business-permissions.ts`), ANDed with `countedMembershipWhere` (owner, or see, or linked to a live row).
- **Editing switches:**
  - The owner edits switches on a member's card (Roster and Team access) in one `PUT .../members/:id/switches`, behind a recent sign-in.
  - The card label derives from the switches (`memberLabel`).
- **What the app offers:** the agenda response carries `act`, and the agenda and calendar offer actions only where the member acts. A linked "see only" member reads the whole business and acts on their own row.
- **Audit:** `SWITCHES_CHANGED` stores `{ before, after }`; `JOINED` and `REVOKED` store the switches held.

## Lessons

- **A role-to-switch migration is proven by recomputing the old rules, not by reading the new code.** `member-switches-migration.test.ts` builds a scratch database at the pre-slice migrations, seeds every role × status × link, records each permission by the old table, migrates, and compares. A deliberate mutation (dropping the "see" branch of the counted rule) made it fail; keep that habit for the next permission migration.
- **"Counted" belongs in every permission query, including in-transaction rechecks.** A switch-only check let an unlinked member with only "manage team" open the team routes; the route matrix in `business-permissions.test.ts` (each switch alone, linked and unlinked) found it.
- **Separate switches split one UI notion into two.** "Worker" used to mean both "sees only their row" and "acts only on their row". Use `workerCalendar` (My day, without see) for the first and `ActingScope` (from the agenda's `act`) for the second.
- **The database triggers read switches now** (`visit_booking_contact_guard`, `visit_notify_booking_event`, latest in `20261120120100_member_switches`). Changing who may book or who is notified means copying the whole function again.
- **Old role names hid outside the API and unit tests.** CI's browser smoke caught the smoke scripts writing `MANAGER` (now refused by `Membership_role_check`), and `BusinessSetup.tsx` admitting only `OWNER`/`MANAGER`, which would have shown a real manager "access denied" on business settings. The screen now trusts the server's `BUSINESS_SETUP` check. Before the next role or permission change, `git grep "'MANAGER'"` across `apps/mobile/scripts` and `components`, not only `src`.
- **`test:web` runs only against the shared local `visit_test` database** (`test-environment.ts` refuses any other name), so a branch with new migrations would migrate it under other worktrees. It was verified in CI, not locally.
- **The worktree used database `visit_slice5`.** Browser checks ran on 127.0.0.1 ports 3009 (API) and 8089 (web), and need a restarted API after server changes (it does not reload). The local test accounts have passwords set by throwaway scripts, which were deleted.

## Not verified

- **Checked:**
  - **API:** full suite 488/488 and typecheck clean.
    - The migration test checks that no one's access changes.
    - `member-switches.test.ts` (13 subtests) covers:
      - owner-only changes, with nobody changing their own or the owner's;
      - 404 for another business or a removed member;
      - act-needs-see as a 400 and as a database CHECK;
      - the recent sign-in, with code `REAUTH_REQUIRED`;
      - the unique key and the owner trigger;
      - the team listing flags;
      - an invitation to an active member linking only a calendar, with its audit;
      - a manager unable to cancel or replace the owner's calendar invitation;
      - an inviter who no longer counts;
      - the agenda's `act` for owner, manager, worker, a linked "see only" worker and an unlinked "see only" member.
  - **Mobile:** lint and tsc clean, 240/240 tests (`acting-scope.test.ts`, `member-switches.test.ts`); Storybook 270/270. CI's first run caught the Roster story's button count, which the Permissions button raised; run `npm run test-storybook` before opening a PR.
  - **Browser pane, 375px, Hebrew RTL:**
    - As the owner: Team access and Roster cards, the editor (act turns see on; see off turns act off and warns an unlinked member), save and label.
    - As a linked "see only" worker:
      - The whole business shows, with their own free time only and footer Add, and no Share.
      - Block time is pinned to their row.
      - A colleague's appointment shows status, history and contact, without Cancel, on the home and in the calendar sheet.
- **Reviews:**
  - **`bf-security-reviewer`:** found nothing at Medium or above. Its two Low audit gaps and two questions are fixed and tested: a manager cancelling the owner's calendar invitation, and an inviter who no longer counts.
  - **`bf-qa`:** found the "see without act" screens (fixed above), plus weak assertions (exact codes and matchers now).
- **Not checked:**
  - Native iOS/Android and English layout.
  - Live-stream ending and notification visibility after losing "see": the code rechecks on every read and delivery, but there is no test.
  - A member with "act" but no setup choosing a row in the block form, in the browser: covered by unit tests only.
  - An unlinked "see only" member's slots in the calendar, in the browser: covered by the `act: null` API test.

## Debt

- **`requireBusinessMembership` does not filter `deletedAt`** (security reviewer, Q3). This predates slice 5; `calendar-scope` checks both. A soft-deleted business may still pass setup and team checks.
- **`lockBusinessConfiguration` rechecks the switch but not the counted rule.** It is safe today because the Business row lock serialises it with switch changes; it would stop being safe if that lock order changed.
- **`visit_booking_contact_guard` has no `SET search_path`.** The other two functions have one; this one is not SECURITY DEFINER.
- **No mobile hook or component tests for the switches editor:** hidden when not editable, reauth versus failure message, Save disabled when unchanged. These states were checked only in the browser.
- **"See without act" free time is hidden, not shown read-only.** A receptionist who only sees cannot tell free time at a glance on the home page; the calendar grid still shows open hours.

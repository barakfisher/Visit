# Visit handoff — 2026-11-03, manual-run fixes done

Supersedes `2026-11-02-settings-done.md` for current state. Its decisions, lessons and debt still hold unless corrected below. Read `2026-11-02-mvp.md` after it; that file's sign-in decisions, local-run notes and MVP debt are still current.

## Authorization

The user's global working agreement governs. Every merge in this period (#36–#40) was an explicit, per-PR instruction from the user, and the `main` ruleset needs `gh pr merge --admin` even when CI is green. This handoff PR was opened under the working agreement's handoff rule; **merging it needs the user's instruction.** None of these is a standing grant.

## Where things stand

`main` is at `9cc7e07` (PR #40). On 2026-11-02 the user ran the first manual end-to-end journey with real password accounts: customer and provider sign-up, administrator approval, every settings screen, publication, booking, agenda, then a 375px round. The findings were grouped into packages A–E, each fixed in its own session and PR, branched off `main`:

| PR | Package | Decision log entry |
|---|---|---|
| #36 | A: booking confirmation copy (route header, cutoff in hours, plurals, "rescheduled", cancelled page, `.ics` in RTL) | "Booking confirmation copy after the manual run — 2026-11-02" |
| #37 | C: provider registration and business details (category unset, Israeli phone, URL-name hint) | "Provider registration and business details after the manual run — 2026-11-03" |
| #38 | B: cancellation flow (in-window warning, server-given card actions, card-level errors, localized confirm, "appointment being moved") | "Cancellation flow after the manual run — 2026-11-03" |
| #39 | D: Appointments page at phone width (vertical list, one "next visit" label, history without duplicates) | "Appointments page at phone width — 2026-11-03" |
| #40 | E: onboarding guidance (Home business card + remembered provider mode, first-setup hours, "Add myself", post-publish next steps, admin menu, login link) | "Onboarding guidance after the manual run — 2026-11-03" |

Hosted CI passed on #40 before merging. The other sessions reported green CI; not rechecked here. The full findings list lives outside the repo (the side-session notes of the run). The leftovers that matter are under "Findings not yet addressed" below.

The VIS items in `2026-11-02-mvp.md` are unchanged.

## Decisions since the last handoff

All are in `docs/architecture/decisions.md` with rejected alternatives, under the entries named above. These are the ones a stranger would most likely reopen:
- **A business has no category until its owner picks one** (`Business.category` is nullable; migration `20261103120000_business_category_unset` turned the old `'General'` default into `NULL`). Do not reintroduce a default. The English string leaked onto Hebrew screens and customer cards.
- **The public phone accepts Israeli local numbers and the app sends E.164; the API stays strict.** One format in the contract.
- **Bookings inside the cancellation window are allowed, with a warning on the review step.** It is not an acknowledgement and not a refusal. The server's cutoff stays authoritative.
- **Customer actions on appointment cards come from the server** (`customerBookingActions` via `/api/consumer/bookings/active`). The app never recomputes the cutoff.
- **The device remembers provider mode** (`visit.providerMode` = `{ identityId, businessId }` only). Customer Home reopens it only while `/v1/me` still lists the business as managed. Switching to customer mode and signing out delete it, and sign-out deletes it before the logout request. The server decides access every time.
- **"Add myself as staff" prefills the ordinary add dialog;** nothing is created automatically on approval, and staff stay unlinked from accounts.

## Lessons (these will recur if forgotten)

- **Home (`/`) is the root stack's `anchor`, so it mounts under every deep link.** Any effect on Home that navigates runs while the user is on `/p/<slug>`, `/booking/…` or a settings section. The remembered-mode restore did exactly that and hijacked deep links. The browser check caught it, and no test did. Gate such effects on `usePathname() === '/'`.
- **The React Compiler lint (`react-hooks/set-state-in-effect`) rejects a synchronous `setState` in an effect body.** Move the state change into the async continuation, or derive it.
- **Fixed-shape `deepEqual` assertions on `menuCapabilities` exist in `vis11-boundaries.test.ts` as well as `navigation.test.ts`.** Adding a field fails both. That's expected; extend the expected object and don't loosen the assertion.
- **Creating local test accounts is fastest through the API with `curl`:** sign-up, `promote-admin.ts`, `POST /v1/provider-applications`, admin decision. Writes need an `Origin` header matching `WEB_APP_URL`, or they return `CSRF_REJECTED`. Sessions last 15 minutes, so sign in again when a cookie jar returns `UNAUTHENTICATED`. New services must not send `active`.
- **The browser pane auto-dismisses `window.confirm`.** Override it in the page to test a confirm path (from package B).

## Running locally

Unchanged from the earlier handoffs, plus:
- **Port pairs in use by worktrees this period:** 3000/8081 and 3010/8091 (`home-screen-design-ea348f`), 3020/8092 with Storybook 6016 (package D), and 3030/8093 (`onboarding-guidance-660e70`). Each uses an untracked `.claude/launch.json`. `NODE_PATH=./node_modules` is required for `expo start`.
- **A new worktree needs** `DATABASE_URL=postgresql://x@localhost/x npm run db:generate --workspace @visit/api` before anything runs.
- **Dev DB test data from this period:** accounts `*-11022221@example.test` (the run), `provider-`/`admin-e11031136@example.test` (package E), business `roni-11022221` (published), `studio-11031` (unpublished, owned by customer-11022221 after the package C check), `dana-e11031136` (published, staff "Dana"). The provider-e11031136 account's language was switched to English. Passwords are only in the side-session notes; never paste them into chat or the repo.
- **Last full results on #40's branch:** test:foundation 141, Storybook 187, API 303, `test:web` 60 PASS.

## Findings not yet addressed (from the manual run)

Notes, not bugs. None blocks the journey.
- The login screen shows "Continue with Google (not configured yet)" to real users.
- Business details: the time zone is a free-text field showing raw `Asia/Jerusalem` (pilot is Israel-only).
- Time block dates and times are typed (`YYYY-MM-DD`, `HH:mm`); there is no picker.
- **Risk, not tried:** the policy offers "Require verified phone" while SMS is disabled for real users. Turning it on may make the business unbookable. Check before the MVP.
- The public business page shows no services, prices or hours before sign-in.
- The agenda item repeats the date on both ends, and the week range is shown as raw ISO dates.
- Share screen: "System share (not supported in this browser)" is shown as a button. Dev-only React warning about `accessible` on the QR.
- Account offers "Send code to verify contact" and a phone tab although delivery is off. "Ownership review (not available yet)" is shown.
- Appointment history is sorted oldest first (package D left it).
- Not in package E's scope: a Home card for a pending or rejected application.

## Debt and its consequences

- **The remembered-mode restore has no automated browser test.** Its rules (`providerModeOnHome`, `parseProviderMode`) are unit-tested, and the flow was checked by hand at both widths. A regression in the Home effect, such as the deep-link bug, would ship unnoticed.
- **A remembered entry outlives an expired session** until the next sign-in on that device, which deletes it, since the identity differs. Two ids, no secret; the security review rated it low.
- **Staff, block and hours conflict counts are still not pluralised;** only Home and the cutoff use `translateCount`.
- **`/api/consumer/bookings/active` and `/v1/me/bookings` spread the raw Booking row** (idempotency key, contact snapshot, ids) into responses. Found in package B, not fixed.
- **Debt from `2026-11-02-settings-done.md`, `2026-11-02-settings.md` and `2026-11-02-mvp.md` still applies,** including the MVP sign-in items: password reset, re-verifying unproven emails, and the password in Account.

## Suggested order

Agree the order with the user first.

1. **Check the "Require verified phone" risk** above. It can silently make a business unbookable.
2. **Decide which leftover notes above are worth a package,** possibly one small copy-and-layout PR (Google placeholder, Share button, agenda dates, Account delivery hints).
3. **Clean up finished worktrees** with the user's OK. This period's are `booking-confirmation-copy`, `provider-registration-details`, `cancel-flow` / `home-screen-design-ea348f`, `next-step-8c8937` and `onboarding-guidance-660e70`.
4. **Return to the MVP handoff's order from item 3:** VIS-14 slice (c), VIS-11, VIS-20 then VIS-17, VIS-7, the native gate, and the MVP sign-in items before the MVP ends.

One branch off `main` at a time; no stacked PRs. Next handoff: after five more merged PRs or a milestone boundary.

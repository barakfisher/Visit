# Visit handoff — 2026-11-19, an MVP account proves its own address (bug 2) (PR #81)

Built on `main` after PR #79. Decisions: `decisions.md`, "An MVP account proves its own address".

## Authorization

The user's global working agreement governs. This session built slice 1 in parallel with the one that shipped it as PR #79. When #80 conflicted, the user chose to close #80 and keep only its bug 2 fix, in this PR.

## Where things stand

- **What MVP owners can do now:** an MVP account (`emailVerifiedAt` set without proof, `unprovenEmail` equal to the address) can prove its own address with the six-digit account code. The owner enters it under Account → sign-in methods; there is no one-tap button.
- **What happens on success:** `unprovenEmail` is cleared, so a later email-link sign-in keeps the password. The event is `LINKED`. Every session rotates, and an alert goes to the previous channels.
- **The code email in this case** warns a reader who never created an account not to share the code (`purpose: 'confirm-own'`, `accountVerificationEmail` in `account-delivery.ts`).
- **Unchanged:** a proven address is still refused (`METHOD_UNAVAILABLE`).

## Lessons

- **Two sessions built login plan stage 2, slice 1 at the same time** (PR #79 merged, PR #80 closed). #80 was started from the stage 2 handoff while #79 was in flight. Before starting a slice, check the open PRs and the linked sessions for the same slice.
- **#80's local leftovers:**
  - #80 created a `PendingSignUp` table in the shared local `visit` and `visit_test` databases, recorded in `_prisma_migrations` as `20261120130000_pending_sign_up`.
  - #79 has its own migration, `20261121120000_pending_sign_up`. On those databases, `prisma migrate deploy` from `main` will fail until #80's table and its `_prisma_migrations` row are dropped.
  - Status: not dropped yet, waiting for the user's word.
- **This branch was tested against its own database, `visit_bug2`,** so the shared ones stay untouched: `DATABASE_URL` is exported, and an explicit environment value wins over `.env`.

## Not verified

- **Checked:**
  - API suite on `visit_bug2`: 506/506.
  - `account-methods.test.ts` 22/22. The new test failed before the fix.
  - Typecheck: clean. The API test typecheck has only the known `booking-operations.test.ts:141`.
- **Security review:** `bf-security-reviewer`: no confirmed findings. Its notes changed the copy (no "the account becomes yours"; "do not share" in the change email too) and added two tests: a verified phone is still refused, and an earlier confirm-own code fails once an email link took the address back. Mutation checks: dropping `&& !unprovenOwn` or forcing `purpose: 'change'` each fails 2 tests.
- **Debt (product decision, open):** the "real owner wins" email link deletes only the password and sessions. A phone or Google that an MVP holder linked stays on the account, so the holder can sign back in alongside the owner. Bounded by production starting empty.
- **Not checked:**
  - `test:web`: it only runs against the shared `visit_test`, which holds #80's table; CI runs it. The change is server-only and adds no screen.
  - Real Resend delivery of the new email.

## Debt

- **The phishing path is narrowed, not closed:** a squatter with an MVP account can still talk the owner into reading out the code. Accepting only the email link for this case would close it.

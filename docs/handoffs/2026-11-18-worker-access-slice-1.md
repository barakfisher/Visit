# Visit handoff — 2026-11-18, worker access design and slice 1 (named permissions) (PR #71)

Built on `main` after PR #70. Decisions: `decisions.md`, "Worker access design", "Member privileges design", "Named permissions in place of role lists".

## Authorization

The user's global working agreement governs. The user asked for the UX and flow of the worker ("privileged user") type, decided each design question in chat, asked for the build plan, and said "Start slice 1". No commit, push or PR was requested yet.

## Where things stand

- [worker-access.md](../architecture/worker-access.md) holds the agreed design: user types, owner and worker flows, states, four per-member switches, and a five-slice build plan.
- Slice 1 is done in the working tree: every provider check names a permission from `apps/api/src/security/business-permissions.ts`, and `rolesWith()` maps it to roles. Owner and Manager hold all six permissions, Staff none, so behaviour is unchanged.
- Slices 2–5 have not started. "Open before slice 3" in worker-access.md lists the security review's questions that must be decided before Staff gets any permission.

## Lessons

- **A worktree has no `.env`.** `env.ts` loads `../../.env` relative to `apps/api`. The suite here was run with explicit variables (`NODE_ENV=test`, `DATABASE_URL` for the `visit-postgres-1` container on 5432, `REDIS_URL=redis://localhost:6380`, a random `SESSION_SECRET`), not the main checkout's `.env`. A new worktree also needs `npx prisma generate` before anything imports `src/generated`.
- **`requireBusinessPermission` is a thin wrapper.** It still returns the strongest *permitted* role as `context.role`, and `validateBusinessPermission` rechecks that exact role. When slice 5 makes switches the source of truth, the context must carry the member's switches, not a role, or rechecks will compare the wrong thing.
- **The configuration lock takes a permission.** `withBusinessConfiguration`, `lockBusinessConfiguration` and `changingAgenda` default to BUSINESS_SETUP; time blocks pass ACT_ON_ALL_CALENDARS. A new caller that forgets the argument gets the stricter default.

## Not verified

- **Checked:** API typecheck clean; full API suite 409/409 including the new `business-permissions.test.ts`, which proves every permission's routes allow the owner and a manager and refuse staff, a pending owner, an outsider and the other business's owner. Independent `bf-security-reviewer` pass: no findings; its quick fixes (frozen grant tables, enum-typed SQL array, unused imports) are applied.
- **Not checked:** the mobile app (no client code changed). `tsconfig.test.json` fails on `test/booking-operations.test.ts:140` (implicit `any`); this fails identically on `main` at `3cc4da4` and is not from this change.

## Debt

- `tsconfig.test.json` typecheck is red on `main` (above).
- The permission matrix test covers reads only; writes are covered by the existing suites but not by a Staff-refused write per permission.

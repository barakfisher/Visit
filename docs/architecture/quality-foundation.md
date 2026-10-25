# Foundation QA and tenant fixtures (VIS-8)

## Scope and coverage map

This is the executable security foundation for current routes and repositories, not sign-off for unimplemented provider review/publishing/contact policy workflows. VIS-14/VIS-17/VIS-20 retain full lifecycle, concurrency stress, and independent authorization regression work.

| Boundary | Evidence |
| --- | --- |
| Two isolated business graphs, six identity/membership combinations, deterministic record IDs, safe exact reset | `apps/api/test/support/two-tenant.ts`, `tenant-fixtures.test.ts` |
| Both directions of foreign list/read/create/update/delete and referenced-ID injection, preserved foreign snapshots | `tenant-fixtures.test.ts` using the actual API factory |
| WeakSet-branded/forged contexts, repository CRUD, role and approval revocation, old issued contexts and customer ownership | `tenant-isolation.test.ts` |
| Cross-business composite FK constraints bypassing repositories | `tenant-isolation.test.ts` (staff/service links, schedules, overrides, time blocks, bookings) |
| Overlap/capacity, full buffers, half-open boundaries, expired holds, raw concurrent writes, transaction rollback/crash, duplicate idempotency and Redis outage | `booking-guard.test.ts`, `redis-slot-lock.test.ts` |
| Origin/CSRF, cookie/token boundaries and explicit proxy trust | `request-security.test.ts`; auth-specific suites remain in the complete API suite |
| Workspace catalog/draft clearing, delayed old-workspace response rejection, no Cache Storage/service workers or private browser storage | exported `apps/mobile/scripts/web-smoke.mts`; context/query clearing and late transport response unit tests in `foundation.test.ts` |
| Readiness vs liveness, Redis startup/outage/recovery, database outage/recovery, bad environment and failed migrations | `apps/api/scripts/infra-smoke.mjs` against a private Compose project |

A customer may legitimately book a different published business; business selection is not provider authorization. Tests substitute staff/service IDs across the selected business instead of asserting that legitimate customer cross-business browsing is forbidden. Public discovery remains subject to publishing work in VIS-34. Non-enumerating hold release returns success for unknown/foreign holds and is checked for *no mutation*, rather than requiring a 404. A dual-business manager may explicitly access either workspace but must select one; no implicit workspace is guessed.

## Repeatable fixtures

From the API workspace or with `--workspace @visit/api` from the repository root:

```sh
npm run fixtures:tenants --workspace @visit/api -- create 11111111-1111-4111-8111-111111111111
npm run fixtures:tenants --workspace @visit/api -- reset 11111111-1111-4111-8111-111111111111
```

An optional ISO date follows the UUID on create. Default is three UTC calendar days ahead, within the fixture's booking window. Identity topology: north-only owner, south-only owner, manager authorized in both, north staff, north pending owner, and authenticated outsider. Anonymous requests have no headers. Each business has its own staff, service, assignment, policy, seven working days, staff schedule, confirmed booking and break.

IDs and example.test contacts derive from the exact UUID; private session tokens are generated in memory for tests and never printed by the CLI. CLI output contains IDs/topology only. Repeat setup of an existing run fails until explicit reset. Reset is idempotent, serialized by a namespace advisory lock, and checks both exact IDs and stored slug/email markers before deleting anything. It never truncates tables, flushes Redis, or deletes by a broad email/ID prefix. Changing a marker makes the entire reset transaction fail before deletions. The reset test preserves an independently seeded sentinel graph. The helper refuses production mode and external DB hosts; disposable Compose uses hostname `postgres`. Do not use fixtures against real customer data.

## Local and CI-ready commands

Install workspace dependencies; generate Prisma and apply committed migrations against disposable PostgreSQL/Redis. The existing `.env.example` documents the local environment. Never supply production auth/delivery credentials to these suites.

```sh
npm run typecheck
npm run lint
npm run db:generate --workspace @visit/api
npm run db:deploy --workspace @visit/api
npm run test:security --workspace @visit/api
npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
npm run test:design --workspace @visit/mobile
npm run test:web --workspace @visit/mobile
npm run test:infra --workspace @visit/api
```

`test:security` typechecks the fixture harness and CLI before running the targeted test set. It supplements the full API suite. The infrastructure command builds a fresh image, creates private database/Redis volumes on a unique Compose project, applies all migrations, executes all API tests, rehearses dependency failures and always attempts cleanup. It leaves development containers and data intact. API test summary counts are parsed and recorded, rather than exposing raw subprocess/provider logs. For committed-source evidence, run the command from an extracted `git archive` and set `VISIT_TEST_COMMIT` to the exact source revision; setting a commit string alone does not prove a clean checkout.

The web harness uses exported web assets on loopback port 8082 and an isolated API factory on 3001, with real PostgreSQL/Redis and synthetic identities. It substitutes only external delivery/OAuth boundaries. It refuses occupied test ports and cleans its own data/processes. The browser test temporarily holds a North catalog response, switches to South, then releases the response and verifies South stays visible with an empty draft and no persisted private catalog. No real OTP or OAuth provider calls are needed.

GitHub runners require Node 22/npm, Docker Compose with health checks and `!override`/`!reset` support, and Playwright Chromium plus its OS libraries. Use the package lock. Store exit codes and upload `apps/api/test-results/infra-smoke.json`, optional sanitized infrastructure failure log, and `apps/mobile/test-results/` screenshots/reports as CI artifacts. The commands are ready for VIS-7; this does not claim a GitHub workflow run or configured branch protection (repository currently has no remote).

## Release evidence still required

Actual iOS/Android boot remains VIS-2 → VIS-43 → VIS-25 following the product owner's approved dependency change. Bundle exports and browser tests cannot establish native runtime, assistive technology, installed-link or live SMS/email/Google behavior. New database models, invitation/review/admin routes and appointment state operations must extend the negative matrix when their owning issues add them; this foundation cannot certify nonexistent endpoints.

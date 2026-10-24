# Local infrastructure and failure checks

VIS-3 implementation and verification guide. Requires Node.js 22+, npm, Docker Engine and Docker Compose supporting `!override`/`!reset` for the isolated smoke test.

## Reproducible startup

1. Copy `.env.example` to `.env`; development credentials are local-only placeholders.
2. Run `docker compose up -d --build`. The API image generates Prisma and compiles TypeScript at build time. Its entrypoint runs `prisma migrate deploy` and starts Node only if migration succeeds. PostgreSQL and Redis must pass their container health checks first.
3. Check `docker compose ps`, then request `http://localhost:3000/health/ready`. Start Expo separately with `npm ci` and `npm run dev:mobile`.
4. Run `docker compose down` for normal shutdown. Named database/Redis volumes remain intact for the next startup.

The Compose API binds localhost:3000; PostgreSQL localhost:5432; Redis localhost:6380. Container-to-container connections use the internal Compose bridge and service names. These exposed ports are for local development only, not a production deployment configuration. Staging is VIS-40.

For API hot reload and the browser's development email inbox, stop the API container with `docker compose stop api`, run `docker compose up -d postgres redis`, then `npm ci`, `npm run db:generate`, `npm run db:deploy --workspace @visit/api` and `npm run dev:api`. Never run the host API and API container on port 3000 together. Docker-forwarded browser requests cannot access the loopback-only development mailbox; run the API on the host for that workflow.

## Migrations, fixtures and reset

- Apply committed migrations: `npm run db:deploy --workspace @visit/api` with the intended local DATABASE_URL.
- Author a new development migration: `npm run db:migrate`. This is separate from normal startup and may prompt when development schema drift exists.
- Fixture/test setup is owned by each test and must not run automatically at API startup. Tests use synthetic identities and isolated business records.
- Normal shutdown: `docker compose down` preserves data.
- **Destructive local reset:** `docker compose down --volumes` deletes this Compose project's PostgreSQL and Redis data. Use only when intentionally resetting the local environment, then rerun normal startup/migrations. This is not a production recovery command.

## Liveness and readiness

`GET /health/live` returns 200 for a running API process without probing dependencies. `GET /health/ready` returns `{ status, database, redis }`, using only `ok`/`unavailable` dependency summaries; it never exposes URLs, credentials or SQL errors.

Readiness is 200 only when PostgreSQL responds, the Prisma migration table exists with no unfinished/unresolved failed migration, and Redis responds. Otherwise it is 503. The container entrypoint also prevents the API from starting before all bundled migrations have been successfully applied. The health endpoint by itself does not compare an arbitrary host process against the filesystem's migration list; use the documented migration-before-start workflow.

PostgreSQL health connections and queries have three-second deadlines. Redis connection attempts have a three-second deadline, including the initial lazy-connect path. Loss of an idle database health connection is handled rather than crashing the process. Independent probes may take several deadlines in sequence; HTTP clients and orchestration must allow the documented dependency probes to finish.

Redis-backed rate limiting and new booking reservations fail closed on outage. PostgreSQL transaction invariants remain authoritative and a Redis failure never authorizes unchecked booking writes. Existing confirmed bookings remain durable.

## Automated isolated smoke test

Run `npm run test:infra` from the repository root. The script:

1. Builds the API image from current source.
2. Creates a unique Compose project with fresh named volumes, private database/Redis ports and a random localhost API port.
3. Verifies bootstrap migrations, startup and exact safe readiness payload.
4. Stops only its own Redis, verifies readiness 503/liveness 200 including a fresh API lazy connection, and verifies recovery.
5. Stops only its own PostgreSQL, verifies bounded readiness failure/liveness, and verifies recovery.
6. Starts a one-off API with invalid SESSION_SECRET and requires field-only configuration failure before listening.
7. Mounts a deliberately failing migration into only the isolated API and verifies its migration-before-start entrypoint exits nonzero without becoming healthy.
8. Removes only its own containers/network/volumes in a finally block.

The test never stops the development app or resets its data. A sanitized result is written to `apps/api/test-results/infra-smoke.json`; raw service logs, credentials and child-process output are not printed on failure. If Docker itself prevents cleanup, the error names the isolated project for manual cleanup. A failed test is not evidence of success for the unexecuted later checks.

Use this command in CI with Docker access and no production secrets. The ordinary API suite remains `npm test --workspace @visit/api`. Staging deployment, automatic backups and recovery objectives are tracked separately in VIS-40–42.

For the complete API suite against the newly migrated isolated services, use `npm run test:infra -- --api-tests`. This adds an integration-suite gate before injecting outages and migration failure. Set VISIT_TEST_COMMIT to the exported source revision when recording commit-specific evidence; it is stored in the sanitized report.

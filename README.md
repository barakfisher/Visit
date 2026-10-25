# Visit scheduling platform

Mobile-first, single-brand appointment scheduling for isolated business tenants.

## Workspace

- `apps/mobile`: Expo Router app for native and web.
- `apps/api`: Node.js TypeScript HTTP API and Prisma/PostgreSQL persistence.
- `docs/architecture`: product and technical contracts that guide implementation.

## Local development

Requirements: Node.js 22+, npm, and Docker Compose.

1. Copy `.env.example` to `.env` and adjust local values if needed.
2. Run `docker compose up -d --build` to start the API, PostgreSQL, and Redis together. The API container applies migrations before starting and becomes ready only when database/migration and Redis checks succeed.
3. For API hot reload, stop the API container (`docker compose stop api`), run `docker compose up -d postgres redis`, install dependencies with `npm ci`, generate Prisma with `npm run db:generate`, apply committed migrations with `npm run db:deploy --workspace @visit/api`, then run `npm run dev:api` and `npm run dev:mobile` in separate terminals.

Expo web uses `EXPO_PUBLIC_API_URL=http://localhost:3000`. For a physical device or Android emulator, set it to an API host address reachable from that device. In local-inbox mode, request a sign-in link from the app and use **Load local development link** on the sign-in screen. Production email delivery uses the server-side Resend adapter and must be configured outside the client app.

Useful checks: `npm run typecheck`, `npm run lint`, `npm run test --workspace @visit/api`, `npm run build-storybook --workspace @visit/mobile`, `npm run test-storybook --workspace @visit/mobile` (requires Playwright Chromium), and `npm run export:web --workspace @visit/mobile`.

Never put production credentials in `.env.example` or client configuration. Local destructive database reset commands are intentionally separate from normal startup. A local Redis port conflict can be avoided by changing the host mapping; the default is 6380 because 6379 may already be in use.

## Decisions

See [architecture decisions](docs/architecture/decisions.md) and [domain/API contracts](docs/architecture/contracts.md).

See [identity and navigation](docs/architecture/identity-and-navigation.md) for the target login/mode-switching contract and [local infrastructure](docs/architecture/local-infrastructure.md) for startup, shutdown, migration/reset procedures and the isolated `npm run test:infra` failure/recovery checks.

## Screen flows

Hebrew is the default app language. Switch to English or Hebrew from **Account → Language**. Signed-in choices save to the account; guest choices save on the device. See [localization policy](docs/architecture/localization.md) for current translated surfaces and the remaining screen conversion work.

The current screens and API contracts are documented in [screen flows](docs/architecture/screen-flows.md), including Google/SMS configuration, provider approval routing, Redis reservations, and the two-browser contention test. The web test uses ports 3001/8082 and leaves the development app on 8081 available.

See [app foundation](docs/architecture/app-foundation.md) for workspace cache boundaries, transport behavior, PWA policy, native bundle commands and remaining device validation.
# Visit

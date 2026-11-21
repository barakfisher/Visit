# Visit handoff — 2026-11-20, hosted environment on Render (PR #82)

Built on `main` after PR #81. Decisions: `decisions.md`, "Hosted environment on Render". Setup and procedures: [production-hosting.md](../architecture/production-hosting.md).

## Authorization

The user's global working agreement governs. The user chose each step in chat:

- Render, on the free plan
- carrying test data over with `pg_dump`/`pg_restore`
- a single-page static web app
- `sirv` for the browser suite

The user asked for this PR. Merging and deploying still wait for their word.

## Where things stand

- **Nothing is deployed yet.** `render.yaml` describes four free resources in Frankfurt:
  - `visit-api`, the root `Dockerfile`, at `api.my-visit.xyz`
  - `visit-db`, Postgres 16
  - `visit-redis`, Key Value
  - `visit-web`, a static site at `app.my-visit.xyz`
- **Next, the user's own steps** (production-hosting.md, "One-time setup"):
  - create the Render account and the Blueprint from `main` (after merge)
  - a production-only Resend key for `EMAIL_API_KEY`
  - two `CNAME` records at Spaceship
- **After the first deploy:** run the "Checks after a deploy" list. Then confirm in the dashboard that the empty `ipAllowList`s really block external access.
- **The web app is now `web.output: "single"`.** `public/index.html` is the shell, and `app/+html.tsx` is gone, because single output ignores it. Native bundles are unaffected: the iOS and Android exports passed after the change.

## Lessons

- **A single-page export 404s on deep links under `expo serve`.** The first browser smoke failed at once on `/provider/dashboard`. Anything that serves `dist` must fall back to `index.html` for paths that are not files. Render's `/*` rewrite does this, and so does `sirv` with `single: true` in `web-smoke.mts`.
- **`*.onrender.com` cannot stand in for the custom domains.** The session cookie is host-only `SameSite=Lax`, and the bundle always calls `api.my-visit.xyz`, so a page served from `onrender.com` is refused (CORS, `403 CSRF_REJECTED`). Test only on `app.my-visit.xyz`.
- **`EXPO_PUBLIC_API_URL` is baked in at build time.** Changing it means rebuilding `visit-web`, not restarting it.
- **Render does not document which of two overlapping static header rules wins.** Keep one rule per header name. That is why bundles get `no-cache` rather than `immutable`.
- **This worktree's generated Prisma client was stale** (from Nov 18), so typecheck failed on `MembershipRole`/`staffId` before any change. `db:generate` needs a `DATABASE_URL` even to generate. Run `DATABASE_URL=postgresql://visit:visit_local_only@localhost:5432/visit npm run db:generate`, as the `Dockerfile` does.
- **`test:web` ran against throwaway containers.** It used Postgres 16 on 5442 (database `visit_test`) and Redis on 6390, through `VISIT_TEST_DATABASE_URL`/`VISIT_TEST_REDIS_URL`. The shared `visit_test` still holds PR #80's leftover migration (see the 2026-11-19 handoff), and this way it stays untouched.

## Verified

- `npm run typecheck`, `npm run lint`: clean, after regenerating Prisma.
- `npm run test:web` on the single-page build: passed, 61 PASS lines and cleanup clean. It ran before two later edits: `httpEquiv` became `http-equiv` in `public/index.html`, and the HSTS header and `ipAllowList: []` were added to `render.yaml`. A fresh export afterwards produced the expected shell: `lang="he" dir="rtl"`, `no-referrer`, the manifest and theme color.
- iOS/Android `expo export`: passed. These are JavaScript bundles, not a device run.
- `render.yaml` validates against Render's published JSON schema (`render.com/schema/render.yaml.json`). A bad region is rejected, so the validator does check.
- `bf-security-reviewer`: no blockers. Its one pre-deploy finding was fixed: Postgres accepted any IP holding the credentials, and now `ipAllowList: []` with a temporary `/32` for dumps. Also applied from the review: HSTS, a hardened dump procedure, and a corrected `onrender.com` sentence.

## Not verified

- Anything on Render itself:
  - the Blueprint applying cleanly
  - the empty allow lists blocking access
  - the live response headers
  - the cookie flow in the phone's browser
  - whether Blueprint sync recreates a deleted `visit-db`
- Real Resend delivery from the hosted API.
- Hosted CI on this branch (runs on the PR).

## Debt

- **Per-IP limits are global behind Render's proxy** (`TRUSTED_PROXY_CIDRS` is empty). Any scanner can lock everyone out of sign-in for 15 minutes. Before real users, check whether Render overwrites or appends `X-Forwarded-For`, then trust exactly one hop.
- **The free Postgres expires 30 days after it was created.** Carry the data over before then (production-hosting.md). Real users need paid plans for the API, Postgres and Key Value.
- **The API container runs as root.** No CSP yet. `renderSubdomainPolicy: disabled` should be set once the custom domains are verified.
- **Shared `/p/<slug>` links preview as plain "Visit Scheduling".** The fix is to serve `og:` tags for `/p/*` only, not to move the app to server output.

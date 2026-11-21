# Hosted environment

The hosted Visit environment runs on Render, described by [`render.yaml`](../../render.yaml) at the repository root. It is the first environment outside this computer: for now its only user is the product owner, testing from a phone. Why Render, the free plan, Frankfurt and the single-page web app: [decisions.md](decisions.md), "Hosted environment on Render".

## What runs where

| Address | Render resource | Plan | What it is |
|---|---|---|---|
| `https://app.my-visit.xyz` | `visit-web`, Static Site | free | The Expo web app as a single-page site (`apps/mobile/dist`). Every path that is not a file is rewritten to `/index.html`. |
| `https://api.my-visit.xyz` | `visit-api`, Docker web service | free | The API from the root `Dockerfile`. It applies migrations, then starts. Ready at `/health/ready`. |
| private only | `visit-db`, Postgres 16 | free | The database. Its allow list is empty, so only Render's private network reaches it; a dump or restore opens it to one address for its duration. |
| private only | `visit-redis`, Key Value | free | Rate limits, reservations and live signals. Nothing outside Render's private network can connect. |

Every resource is in Frankfurt. Regions cannot change after creation.

The web app and the API must stay on two subdomains of `my-visit.xyz`. The session cookie is host-only and `SameSite=Lax`, so the browser sends it from `app.` to `api.` only because they share a registrable domain. Render's own `*.onrender.com` addresses are separate sites to a browser. A page opened there still calls `api.my-visit.xyz`, and the API refuses it (CORS, and `403 CSRF_REJECTED` on every write), so it fails closed. Once both custom domains are verified, `renderSubdomainPolicy: disabled` can switch those addresses off.

`EXPO_PUBLIC_API_URL` is baked into the web bundle when it is built. Changing it means rebuilding `visit-web`.

## Free plan limits (accepted for one tester)

- **The API sleeps after 15 minutes without requests** and takes about a minute to wake. The first open after a pause is slow. The notification workers sleep with it, so a notification email waits until the next request wakes the API. Live updates reconnect when it wakes.
- **The free Postgres expires 30 days after it was created**, with 14 more days before Render deletes it. It has no backups. Carry the data over as described below.
- **Free Key Value keeps nothing across restarts.** Short-lived reservations and limits start over. Nothing permanent lives there.
- **Real users need paid plans** for the API (`starter`), Postgres (`basic-256mb` or larger, which has backups) and Key Value (`starter`). That is a `plan:` change in `render.yaml`, not a rebuild.

## Deploys

Both services build from `main`, and only after the GitHub "Quality gates" checks pass on that commit (`autoDeployTrigger: checksPass`). Each service rebuilds only when its own paths change (`buildFilter`), so a documentation-only merge deploys nothing.

## One-time setup

The product owner does these steps. They need their own accounts and secrets.

1. **Render account.** Sign up at render.com with GitHub and give Render access to the `Visit` repository only.
2. **Create the Blueprint.** Choose New → Blueprint, select the repository and the `main` branch. Render reads `render.yaml` and lists the four resources.
3. **Secrets.** Render asks for every `sync: false` value:
   - `EMAIL_API_KEY`: a Resend key restricted to sending from `mail.my-visit.xyz`. Create a separate key for production, not the one in the local `.env`, so either can be revoked alone.

   Render generates `SESSION_SECRET` itself. Secrets live only in Render, never in the repository.
4. **DNS at Spaceship** (Nameservers & DNS → Advanced DNS). Add two `CNAME` records. Copy the target hostname that Render shows under each service's Settings → Custom Domains, because the service name may have gained a suffix.
   - `app` → `visit-web….onrender.com`
   - `api` → `visit-api….onrender.com`

   Render issues the HTTPS certificates once the records resolve.
5. **First deploy.** If a service built before DNS was ready, use Manual Deploy → Deploy latest commit.

## Checks after a deploy

- `curl -sS https://api.my-visit.xyz/health/ready` answers `200`.
- `curl -sSI https://app.my-visit.xyz/p/anything` answers `200` with `content-type: text/html`, `cache-control: no-cache`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `x-frame-options: DENY` and `strict-transport-security: max-age=31536000`.
- `curl -sSI https://api.my-visit.xyz/health/ready` carries `cache-control: no-store`.
- On the phone, open `https://app.my-visit.xyz`, create an account, get the six-digit code by email, sign in, and reload a deep page (for example a business page). It should open rather than show "not found".

## Carrying test data to a new free database

Do this before day 30. Render allows one free database per workspace, so dump the data first, then replace the database, then restore. The commands use the `postgres:16-alpine` image, which matches the server version, so nothing needs to be installed.

The dump holds password hashes, email addresses and live sessions:

- Keep it in `~/visit-backups`, readable only by you, outside the repository.
- Never commit, paste or upload it.
- Delete old dumps once a restore has worked.

In the commands below, the connection URL is typed at a hidden prompt, so it stays out of the command line and the shell history. Each command runs in a subshell, so the variable disappears even when a step fails. `PGSSLMODE=require` refuses an unencrypted connection. The terminal prompt here drops the first pasted character, so check the first character when pasting.

1. **Open the database to this computer only.** In Render → `visit-db` → Networking, add your current public IP address as `<address>/32`.
2. **Dump.** In Render → `visit-db` → Connect, copy the **External** Database URL. Then run:

   ```bash
   (umask 077 && mkdir -p ~/visit-backups && chmod 700 ~/visit-backups && read -rs RENDER_DB_URL && export RENDER_DB_URL && docker run --rm -e RENDER_DB_URL -e PGSSLMODE=require -v ~/visit-backups:/backup postgres:16-alpine sh -c 'umask 077 && pg_dump "$RENDER_DB_URL" --format=custom --file=/backup/visit-$(date +%F).dump')
   ```

   Check that the file is not empty (`ls -l ~/visit-backups`).
3. **Replace.** Delete `visit-db` in Render. Then run Blueprint → Manual Sync, which creates `visit-db` again from `render.yaml` and reconnects `DATABASE_URL`. If the sync does not create it, create a free Postgres 16 database in Frankfurt named `visit-db`, with database `visit` and user `visit`, then sync. Add your `/32` address to the new database's allow list, as in step 1.
4. **Restore.** Copy the new database's External URL. Then run:

   ```bash
   (read -rs RENDER_DB_URL && export RENDER_DB_URL && docker run --rm -e RENDER_DB_URL -e PGSSLMODE=require -v ~/visit-backups:/backup postgres:16-alpine sh -c 'pg_restore --no-owner --no-privileges --dbname="$RENDER_DB_URL" /backup/visit-YYYY-MM-DD.dump')
   ```

   Replace `YYYY-MM-DD` with the date in the file name.
5. **Close the database again.** Remove the `/32` entry, or run Blueprint → Manual Sync, which should restore the empty list from `render.yaml`. Check Networking afterwards, since that sync behaviour is not verified.
6. **Restart the API.** Use Manual Deploy → Deploy latest commit on `visit-api`. The dump includes `_prisma_migrations`, so the API's startup `prisma migrate deploy` applies only the migrations that came after the dump.

## Open debt

- **Client IPs:** `TRUSTED_PROXY_CIDRS` is empty, because Render does not publish its proxy addresses. Every request appears to come from Render's proxy, so per-IP rate limits are shared by everyone. This is harmless for one tester but wrong for real users.
- **Link previews:** a shared `/p/<slug>` link previews as plain "Visit Scheduling", because preview bots do not run JavaScript.
- **The API container runs as root** (no `USER node` in the `Dockerfile`). Switching needs a run of the image to show that startup migrations and Prisma still work as `node`.
- **No Content-Security-Policy yet:** Expo web's inline styles need testing first. Start with `Content-Security-Policy-Report-Only`.
- **Unverified Render behaviour:** check these in the dashboard after the first deploy:
  - that the empty allow lists really block external access (Networking)
  - whether Render overwrites or appends `X-Forwarded-For`, which decides whether trusting one proxy hop is safe
- **Native app:** installed iOS/Android builds (EAS Build, TestFlight) are not set up. This environment covers the web app in the phone's browser only.

# Screen flow implementation

## Routes and identity

- `/auth/login`: Google and SMS OTP options, six-digit OTP autofill, and the existing passwordless email fallback at `/auth/email`.
- `/auth`: compatibility redirect; old email links containing `token` continue to `/auth/email`.
- `/discover`: searchable provider FlatList, category chips, active-booking carousel, cancellation and rescheduling. Only an unfiltered directory with exactly one provider bypasses discovery. A search result containing one provider does not trigger navigation.
- `/booking/[providerId]`: providerId identifies a business tenant, while staffId identifies the assigned resource within it. Service, working-day calendar, availability, hold countdown and sticky confirmation share a screen.
- `/provider/dashboard`: an approved owner's or manager's workspace. A business picker supports multiple memberships. Agenda, service catalog and working hours are tabs. Advanced existing settings remain at `/provider/[businessId]`.

`useAuthStore` is an alias of the existing Zustand session store, so there is one identity source. It holds profile and in-memory native token; native token persistence uses SecureStore. Web sessions use HttpOnly cookies; the server intentionally does not expose a web session token to JavaScript. `/api/auth/me` derives `is_provider` from active OWNER/MANAGER memberships in approved businesses. Client role flags never grant API access.

Successful sign-in routes approved providers to their dashboard and other users to discovery. A validated relative booking return path takes priority so direct booking links can resume after login. Pending provider applications remain on the customer side until approved.

## API boundary

New screen contracts use `/api` routes. Existing `/v1` endpoints remain compatible. Where behavior already exists, the `/api` adapter invokes the existing validated handler internally instead of duplicating its authorization and validation logic.

- Authentication: `GET /api/auth/capabilities`, `GET /api/auth/me`, `POST /api/auth/otp/send`, `POST /api/auth/otp/verify`, `POST /api/auth/google`.
- Public directory: `GET /api/providers?search=&category=`, `GET /api/providers/:providerId`, `GET /api/providers/:providerId/availability?serviceId=&date=`.
- Customer: `GET /api/consumer/bookings/active`.
- Reservation: `POST /api/bookings/lock-slot` with providerId, staffId, serviceId, startsAt and idempotencyKey; `POST /api/bookings/confirm` with holdId; `POST /api/bookings/:holdId/release`.
- Provider: `GET /api/provider/agenda?businessId=&date=`, `GET|POST /api/provider/services?businessId=`, `GET|PUT /api/provider/working-hours?businessId=`, `POST /api/provider/block-time`, `DELETE /api/provider/block-time/:blockId?businessId=`. Explicit tenant selection is required for ambiguous multi-business accounts.

Services use integer minor currency units internally. Daily expected revenue is grouped by currency; different currencies are never added together. Provider contact actions are disabled when no phone number exists. Reviews have no storage/integration yet and appear as `(Reviews coming soon)`. Location and category are real optional business metadata; missing locations are labelled.

## Reservation and break safety

A slot click creates a HELD database record and an owned Redis reservation lasting five minutes. Redis atomically reserves whole-minute buckets covering the service plus buffers, respecting staff capacity. PostgreSQL serializable transactions remain authoritative across old and new clients. Redis outages fail the new reservation endpoint closed. Confirmation validates owner, Redis reservation and database expiry before changing status to CONFIRMED. Confirmation retries are idempotent.

Selecting a different date, service or slot releases the previous hold. Late responses and screen unmounts release obsolete reservations. Both Redis and the database expiry rules recover holds after crashes or closed browsers. Expired holds cannot confirm. Other clients see availability refresh every two seconds; a conflict response immediately disables the contested time and shows an accessible alert in the sticky footer.

Manual breaks are tenant-scoped staff intervals in TimeBlock. Availability and booking/rescheduling transactions check them. Break creation rejects overlaps with confirmed appointments or unexpired holds and uses the same interval mutex as booking writes. Closed days come from weekly hours and date overrides, rather than assuming every business closes on weekends.

## External authentication configuration

Default local login keeps SMS/Google buttons disabled until configured. For local-inbox email testing, run the API on the host with `npm run dev:api` and PostgreSQL/Redis in Docker; Docker-forwarded browser requests are not loopback clients and cannot access the development inbox endpoint.

Server `.env`:

- `SMS_DELIVERY_MODE=twilio` plus TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID enables real Twilio Verify send/check. Never put these credentials in the client.
- `SMS_DELIVERY_MODE=local-inbox` enables development-only OTP storage. Local tests retrieve a code from `/__dev/otp?phone=...`. This endpoint is restricted to development mode and loopback clients; production rejects local-inbox configuration.
- Google uses the first-party authorization-code + S256 PKCE broker described in [google-authentication.md](google-authentication.md). Configure server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and exact `GOOGLE_CALLBACK_URL`. Legacy `GOOGLE_CLIENT_IDS` and raw ID-token login are retired. No email match automatically links identities.

Web launches Google with full-page navigation, then scrubs the opaque callback grant from URL and Router state before explicit confirmation. There is no GIS script, browser Google token or public client secret. Native uses Expo SDK 58's system auth browser and a separate in-memory app PKCE verifier/state. It never uses the old GoogleSignin ID-token SDK. Expo Go remains disabled.

`apps/mobile/.env.example` documents optional `EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL`. It must exactly match the server's `GOOGLE_NATIVE_RETURN_URL`. Production requires HTTPS `/auth/google`, a new app build with associated domains / verified Android intent filters, and hosted signed association files. iOS HTTPS auth callbacks require iOS 17.4+ (`preferUniversalLinks: true`); older iOS stays disabled. Development binaries can use `visit://auth/google` only when allowed by the development API. Actual Google consent, client registration, installed app-link handling and SMS delivery remain VIS-43 and are not certified by adapter tests or bundle exports.

## Validation

- `npm run typecheck` and `npm run lint`.
- `npm test --workspace @visit/api`: existing booking/auth/isolation coverage plus OTP single use, simultaneous Redis holds, confirm ownership/expiry, agenda authorization and manual-break conflicts.
- `npm run test-storybook --workspace @visit/mobile`: real Chromium interaction and accessibility checks for time chips, calendar and active-booking states.
- `npm run test:web --workspace @visit/mobile`: exports the web application, then starts an isolated API on 3001 and web server on 8082. It refuses occupied test ports and preserves the app on 8081. Requires local PostgreSQL/Redis and Playwright Chromium. It creates unique fixtures and removes its own records and reservation keys.

The Playwright script substitutes only the external Google provider boundary while exercising real broker routes, Redis, database, cookies, preview and consent. It covers Google login/linking/conflict/cancellation, callback scrubbing and proven-identity profile recovery, plus phone OTP login, service/date/slot selection, live Redis hold/countdown, confirmation, calendar download, provider auto-routing and agenda verification, manual breaks, reschedule and cancellation. Two independent browser contexts are synchronized before their lock requests are released together; exactly one must succeed and the other must show a conflict and disabled slot. The race winner is intentionally not predetermined.

Screenshots are written to `apps/mobile/test-results/` for visual review. Native keyboard autofill metadata is present; actual device autofill and Google consent still need a configured native device run.

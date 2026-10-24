# Expo application foundation (VIS-2)

## Structure and development

The app uses Expo SDK 58, Expo Router's `app/` directory, TypeScript, NativeWind design tokens, Zustand for identity/workspace UI state, and TanStack Query for server data. Shared components live in `components/`; transport, state and localization live in `src/`. Platform APIs are isolated in adapters such as `sessionToken.ts` (web memory versus native SecureStore). Do not import server configuration or credentials into client code.

From the repository root:

- `npm ci`, `npm run db:generate`, and the API/data-service startup in `local-infrastructure.md`.
- `npm run dev:mobile` starts Metro; `npm run web --workspace @visit/mobile` opens web.
- `npm run ios --workspace @visit/mobile` / `npm run android --workspace @visit/mobile` open an available simulator/emulator or device. Custom native modules require a development build. No native project directories are checked in; use Expo configuration/CNG.
- `npm run export:web --workspace @visit/mobile` builds web. From `apps/mobile`, `NODE_PATH=./node_modules npx expo export --platform ios --platform android --output-dir dist-native` checks both native bundles. Bundle export is not a device boot check.
- For physical devices set `EXPO_PUBLIC_API_URL` to the host's reachable LAN address; Android emulator host access normally uses `10.0.2.2`. Client configuration is public. Google/Twilio credentials remain on the API.

## Workspace and request boundaries

Provider queries use business-aware prefixes (`['provider', businessId, ...]`). Workspace changes clear the entire query/mutation cache, cancel active queries, advance a context version, and remount provider workspace forms. Identity changes and logout do the same. A refreshed profile that no longer includes the selected business also clears it. Business selection must come from the current profile; the server still authorizes every request.

`apiClient.ts` is platform-independent and receives storage, platform and session adapters from `api.ts`. It rejects external request URLs before reading credentials, normalizes headers, includes cookies/native tokens, enforces a 15-second request/body deadline and returns structured `ApiError`s. Requests use `cache: no-store`. Late responses from a different identity/workspace are discarded. A single shared refresh retries unauthorized requests once. Only confirmed refresh expiry clears identity; 403, server outages and network failures preserve it. Client cancellation does not reverse a write already accepted by the server; callers must reload authoritative server state.

Remote data stays in Query; editable component drafts stay local and reset on workspace remount. There is no persistent Query cache. Domain screens own their loading, empty, failure and retry presentations; remaining product/accessibility/localization work is tracked by those screen issues.

## Web/PWA policy

The HTML links `public/manifest.json` and supplies the theme color. The manifest points to existing 192/512 pixel icons. The app registers no service worker and creates no Cache Storage entries. `public/service-worker.js` is an unused network-only placeholder with no fetch handler; it is not an offline implementation. Authenticated pages and bookings require a network connection.

The API sends `Cache-Control: no-store` for every response, including errors. Production hosting must preserve this header and avoid caching private HTML/API responses; only fingerprinted public assets may receive immutable caching. Deployment/header checks remain VIS-40. Any future offline/service-worker feature requires a separate review of tenant data and logout cleanup.

## Verification and remaining native evidence

- `npm run test:foundation --workspace @visit/mobile`: 10 transport/session/cache tests, including concurrent refresh, outage preservation, context changes, deadlines, private cache cancellation and revoked workspace selection.
- `npm run test:web --workspace @visit/mobile`: exported web navigation/booking tests plus actual two-business form/catalog switching, linked manifest/icons, no-store API responses and empty browser caches/service-worker registrations.
- `npm run typecheck`, `npm run lint`, API regression tests, and iOS/Android bundle export.

These checks passed locally on 2026-10-24. **Native boot acceptance is still open**: this host has Command Line Tools without full Xcode, no Android emulator executable and no connected `adb` device. No native simulator/device smoke is claimed. Before VIS-2 is Done, open a development build on iOS and Android, record OS/build and screenshots, and verify login/account/discovery navigation, Hebrew/English direction, keyboard entry and absence of startup exceptions. Full native pilot lifecycle remains VIS-43.

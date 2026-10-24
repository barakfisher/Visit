# Hebrew, English and bidirectional UI

Product decision confirmed 2026-10-24 for VIS-31: support Hebrew and English; Hebrew is the default; provide a language switch in account settings and RTL Hebrew layouts.

## Language selection and persistence

- Supported app locales: `he` and `en`. An unrecognized, missing or corrupt preference falls back to Hebrew. Device language does not override this product default.
- For signed-in users, the server's `Identity.preferredLocale` wins. If unset, use the identity's device cache, then an explicit guest-device choice, then Hebrew.
- Account settings changes apply immediately, save non-secret device cache and, when authenticated, call `PUT /api/account/preferences` with `{ locale: 'he' | 'en' }`. The server derives the identity from the session and rejects extra identity/tenant fields. Database constraints reject other persisted locale values.
- `GET /api/auth/me` returns the account preference. A fresh device restores it after session hydration. This preference grants no role or business access.
- Guests can change the language from the account screen; it persists on that device. A null account preference inherits the explicit guest choice on that device until an account setting is saved. Server account preferences take precedence on subsequent devices.
- Storage/network failure leaves a usable session and shows a translated save failure rather than claiming persistence. Mutation controls are disabled while saving. Stale identity/profile hydration must not overwrite another identity's preference.

## Direction and presentation

| Content | Policy |
| --- | --- |
| Hebrew app content | RTL root content direction and right-aligned reading order |
| English app content | LTR root content direction and left-aligned reading order |
| Navigation | Expo Router LocaleProvider follows the selected app direction for headers, transitions and gestures |
| Text/accessibility | AppText sets writing direction, alignment and locale metadata; use translated accessible names and status messages |
| Phone, OTP, email, URL/slug, IANA timezone and UTC offset | Explicit LTR input/run; isolate embedded strings with Unicode LTR isolate/PDI so punctuation cannot reverse surrounding Hebrew |
| Business/customer names | User-provided content is never translated; isolate Latin/identifier runs where mixed with surrounding RTL text |
| Brand, logos, phone/clock/check icons | Never mirror |
| Back/next arrows and directional navigation | Mirror according to app direction; use logical start/end layout rather than manual left/right positioning |
| Dates and time | Gregorian date and 24-hour clock, formatted with he-IL or en-GB and an explicit business IANA timezone |
| Currency | Intl locale formatting with server-provided currency and integer minor units; selecting Hebrew never changes the booking's currency |
| Working days | Follow business/staff schedule and overrides, never infer closures from locale or assume weekends are closed |

The display locale never changes UTC booking instants, business timezone, DST policy, working-day boundaries or money values. Browser `html` lang/dir and root content follow the app locale. Native content uses inherited Yoga direction and Expo Router runtime navigation direction; the app does not force global I18nManager changes or trigger reload loops in Expo Go. Native direction, accessibility and gesture behavior still require device evidence.

## Translation contract

`apps/mobile/src/i18n/messages.ts` owns matching English/Hebrew dictionaries and the MessageKey type. `useAppLocale().t(key, params)` renders text. New screens use these keys rather than inline copy; Hebrew dictionary completeness is checked by TypeScript and component tests. Missing runtime translation entries fall back to English.

Namespaces already cover language, common actions, navigation, authentication, account, business setup/publishing, administrator approval, contact verification, booking and agenda operations. Extend both dictionaries together. Keep identifiers and provider-generated content out of translation dictionaries. Do not concatenate translated fragments when word order can differ; use named interpolation and LTR isolation for embedded contact identifiers.

Shared useAppLocale/LocalePreview context is independent of API/native storage. Storybook renders isolated locale examples without a server or native Expo modules. The application provider separately handles account/device persistence and auth hydration.

## Evidence and coverage

| Surface | Hebrew mobile RTL | Hebrew desktop RTL | English mobile LTR | English desktop LTR |
| --- | --- | --- | --- | --- |
| Login branding, Google placeholder, phone, OTP labels and email entry link | Playwright screenshot | Playwright screenshot | Playwright screenshot | Playwright screenshot |
| Language settings, selected-state semantics and mixed-script component sample | Storybook + axe | Storybook + axe | Storybook + axe | Storybook + axe |
| Account menu, provider application labels and persistence | Playwright guest/account flows | Shared responsive screen | Playwright guest/account flows | Shared responsive screen |
| iOS/Android text, navigation gestures, keyboard/autofill and language restoration | Manual smoke required | Not applicable | Manual smoke required | Not applicable |

Commands: `npm run typecheck`, `npm run lint`, `npm test --workspace @visit/api`, `npm run test-storybook --workspace @visit/mobile`, `npm run test:web --workspace @visit/mobile`.

Screenshots: `apps/mobile/test-results/login-{he,en}-{mobile,desktop}.png`. Web coverage verifies Hebrew default, HTML lang/dir, LTR phone input, switch/reload persistence and authenticated preference restoration with fresh device storage. API tests cover unauthorized writes, other-identity injection, unsupported locales and isolation between identities.

## Remaining screen work

VIS-31 establishes the policy, persistence, reusable keys and representative surfaces. Existing email verification, discovery, booking/confirmation and provider agenda/settings still contain legacy English copy and need conversion plus RTL layout review in their owning VIS-13/18/22/24/28/29/35 issues and VIS-6 design coverage. Their current layout direction alone is not evidence of complete Hebrew localization. Native manual smoke is tracked separately in VIS-43 and the release gate VIS-25.

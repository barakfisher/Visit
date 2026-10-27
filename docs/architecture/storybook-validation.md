# VIS-11 — Independent browser component validation

Scope: compact advisory booking, Home/My Providers, upcoming appointment and context-aware navigation. Legacy horizontal calendar/global search stories remain regressions, not pilot acceptance flows.

## Implementation

Navigation now exposes a typed pure view and separate orchestration hook. Production membership/profile/session checks are preserved. Drawer dismissal uses Close, Escape or a tap outside the panel. The tap-outside backdrop is non-focusable, so it stays out of React Native Web's programmatic focus trap; the isolated runner checks Tab/Shift+Tab containment and a real pointer dismissal with focus return. Booking review and final action are typed pure components reused by the production booking screen.

Independent 320px checks found calendar targets only 34px wide. The day grid fills the sheet with a minimum of seven 44px targets (`tokens.layout.minTouchTarget`) and scrolls horizontally only below that, so the full week is visible from 375px phones upward (asserted by the isolated runner) while 320px and 200% zoom keep reachable 44px targets; the sheet scrolls vertically at constrained heights and zoom. Keyboard selection returns focus to its trigger. Safe-area-context is excluded from Vite dependency prebundling so its real web implementation resolves instead of native Flow sources.

## Acceptance matrix

| Requirement | Isolated evidence | Supporting production evidence |
| --- | --- | --- |
| zero/one/many saved providers; loading/error/unavailable | Home/Screen stories | exported-web Home regression |
| customer/pending/approved/multiple memberships/provider mode; failure/loading | Home/Navigation stories; focus cycling/return | exported-web mode/session authority regression |
| service selection, no services/dates/slots, closed days, calendar loading/error, preference, pagination/conflict | Booking/Compact controls stories | actual sole-service auto-selection, bounded next-date search, six-slot paging and stale-slot removal in exported-web |
| advisory review; final processing/expiry, single callback | Booking/Advisory review and Final consent stories | actual zero DB writes before consent, response-loss same-attempt recovery, concurrent booking winner/loser in exported-web |
| unsupported appointment actions | existing persisted success/upcoming policy stories | owned details and cancellation browser regression |
| Hebrew default/RTL, English/LTR, Israel DST | QA default-locale/calendar/fold tests; Hebrew/English stories | traveler device fold/confirmation browser regression |
| actual NativeWind, contrast, touch targets, long text, mobile/desktop/200% | 52 isolated static-build browser cases, screenshots and computed-style/contrast checks; Storybook axe error gate | exported-web Hebrew long-content regression |

FinalAction's local processing fixture proves view-level double-click suppression. It does not independently prove backend idempotency; the actual booking browser scenarios supply that evidence. Static review has no API or hold callback. Isolated scenarios block and fail on every external network request, and use no API/Redis/provider credentials. The supporting production browser suite uses separate local synthetic DB/API fixtures.

## Reproduction and retained evidence

- `npm run test-storybook --workspace @visit/mobile`
- `npm run test:foundation --workspace @visit/mobile`
- `npm run test:vis11 --workspace @visit/mobile`
- `npm run typecheck` and `npm run lint`
- `VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile`

Run the database-backed browser/API suites sequentially. Preserve unrelated user services on 3000/8081/8082. The isolated layout runner binds an ephemeral loopback static server and closes it/browser on completion.

Evidence is retained under `docs/evidence/vis11/`: implementation source commit and clean worktree status in report.json, all 52 screenshots, test/build logs and a build archive SHA256 manifest. Rebuild and rerun from the recorded implementation commit to reproduce. Local `.ai/` is excluded from the clean-source assertion because it is intentionally untracked project context. The evidence follow-up commit contains artifacts for that implementation commit, avoiding a self-referential artifact hash.

## Independent audits and limits

Fresh test-only QA added six tests including 240 capability combinations, undefined/empty inputs, immutability, Hebrew defaults, fold identity/conflict removal and calendars across three device timezones. Foundation: 77 passed. Fresh read-only Security audit reviewed authorization/session fences, escaped data, final operation guard, network isolation and loopback path containment; no outstanding blocking findings. No source edits by auditors.

52 layout cases cover 320/390/1280px and 640px at CSS zoom 2. Computed rendered text contrast must be at least 4.5:1 for these opaque RGB fixtures; this scanner is not a general alpha-compositing auditor. Axe checks and accessible labels/selection semantics are browser evidence. Physical VoiceOver/TalkBack/touch and live-provider acceptance remain VIS-2 → VIS-43 → VIS-25. No deployment or live delivery is performed.

Hosted CI must be inspected at the actual final head. A billing/spending failure before startup with zero steps is not passing CI. Merging is decided by the repository owner per change; no admin/force bypass or billing change.

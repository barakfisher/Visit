# Shared design foundation (VIS-6)

## One brand, semantic tokens

`apps/mobile/src/design/tokens.json` is the single token source, consumed by Tailwind/NativeWind and the typed runtime export `tokens.ts`. Businesses supply business content, never their own theme. Semantic colors distinguish text, decorative dividers (`line`), interactive boundaries (`controlLine`), selected/pressed, feedback, focus and surfaces. Do not use a decorative divider as the only boundary of an input or outlined button. Disabled controls retain readable text; use a disabled attribute and an explanation, rather than reduced opacity as the only signal. Supported actions stay actionable; future actions remain disabled with an availability explanation.

The normal body scale starts at 16/24, captions at 14, headings at 24/32. Native Text retains default font scaling. No shared card/control truncates or clamps user content. Tokens define 44px minimum target dimensions and 56px primary buttons/inputs. Layouts must allow translated labels to wrap and grow vertically. Larger text must never be constrained by a fixed-height container.

## Layout and direction

`ScreenContent` centers fluid content with 20px padding and a 960px readable maximum; forms use 480px. Place it inside the screen's ScrollView/keyboard-aware shell (login consumes this primitive). At narrow widths stack or wrap card actions, prices and descriptions. Do not scale mobile controls down on desktop. Calendar is deliberately horizontally scrollable, with a visible scrollbar, padding for the focus ring and native keyboard focus scrolling. All other foundational controls must fit their container at a 320px viewport and 200% browser zoom.

Locale is Hebrew by default, with English available through account settings. `AppText` and `ScreenContent` apply current direction. Contact identifiers, time/offset labels and timezone identifiers are explicitly LTR; surrounding copy stays in the selected language. No shared control encodes a directional back arrow. Navigation icons that indicate direction must mirror using current locale. Locale display cannot change the selected business timezone or UTC booking instant.

Callers supply already localized full date labels and duration/price data. Calendar accessible names include both visible text (including closed/selected status) and full dates. Active booking lists explicitly format dates/times using the current locale and the business timezone. Repeated DST clock times retain their offset labels from `slotLabels`; selecting them continues to submit the exact original slot ID/instant.

## Shared behavior

- `Control`: React Native Pressable, minimum target sizing, native keyboard focus border. Standard web button Enter/Space activation; no custom keyboard handler that double-submits.
- `SectionNavigation`: horizontally scrollable section buttons with native selected state/browser pressed state, current-section checkmarks, disabled explanations and standard keyboard behavior. It uses button semantics, avoiding incomplete ARIA tab/toolbar keyboard contracts. Screen owners can adopt it as they complete their navigation.
- `ActionButton`: stable accessible name while busy; explicit web `aria-busy` plus native accessibility state; disabled while pending; secondary/disabled variants.
- `TextField`: visible label, native accessible label/hint, browser description association and invalid state, readable error alert, native/web focus border, identifier direction override. Phone/OTP components preserve mobile keyboard/autofill metadata. Do not persist OTP values in stories or fixtures.
- Service/time/calendar choices expose native selected state and explicit browser `aria-pressed`. Selection also has a checkmark/text. Locked times and closed dates have localized text and disabled semantics.
- Availability exposes distinct loading, empty, error and ready text. Retry appears only when a real callback exists. Skeletons are noninteractive; time loading group has a named status and busy state.
- Shared booking cards wrap long content and actions. Missing action callbacks render no misleading actionable control.

The global web stylesheet restores a 3px high-contrast focus-visible ring with 3px offset, including links and inputs affected by React Native Web resets. Reduced-motion preference disables CSS animation/transitions/smooth scrolling. Native controls use React Native primitives and preserve system text scaling; browser CSS does not implement native focus or motion behavior.

## Reproducible checks

From the repository root:

```sh
npm run typecheck
npm run lint
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
npm run test:design --workspace @visit/mobile
npm run test:web --workspace @visit/mobile
```

Storybook: `npm run storybook --workspace @visit/mobile` (localhost:6006). The language toolbar is explicit: existing isolated examples default to English; localized stories override it. `Foundation/ResponsiveControls` exercises Hebrew/English at compact 320px, mobile 390px and desktop 960px with synthetic long descriptions, validation, disabled/busy, recovery, selected/locked/closed, keyboard activation/focus and horizontal future-date selection. All stories run axe in the browser. Vite 8 OXC must explicitly use the NativeWind JSX import source; `preview.ts` registers web CSS interop under the test environment, and optimized dependencies are predeclared to prevent a test-time browser reload. Computed background/radius assertions guard against silently unstyled stories. A styled axe run caught and fixed the selected service duration's insufficient contrast. Static style arrays in `Control` preserve target sizing through CSS interop; combining a style callback with an injected CSS style array lost the callback in the initial implementation, caught by geometry assertions.

`test:design` builds Storybook, serves it on a random loopback port with no API/provider credentials, runs eight Hebrew/English viewport/200% zoom checks and stores screenshots plus source commit/dirty metadata in `report.json` under ignored `apps/mobile/test-results/design/`. The server/browser are closed afterward. No production service is called. Inspect screenshots as well as geometry checks; axe and contrast math cannot establish visual quality or real screen-reader behavior by themselves.

Token tests assert WCAG normal text >=4.5:1 for approved pairs and focus/control boundaries >=3:1 on adjacent surfaces. `muted` is intended for white/canvas; use `body` on brandSoft. Arbitrary unreviewed token combinations are not certified by these tests. Browser E2E separately verifies actual authentication, booking, DST choices, provider context/cache and catalog flows.

## Remaining native and release gates

User approved proceeding with independent VIS-6/VIS-8 work while VIS-2 remains In Review and explicitly blocks VIS-43 → VIS-25. iOS/Android bundle exports establish compilation only. Real native boot, VoiceOver/TalkBack, large system text, hardware keyboard focus, RTL gestures, OTP autofill and app-link navigation require simulator/device evidence under those gates. No native device accessibility or external delivery success is inferred from browser tests. Remaining screen-level translation and accessible navigation work stays in the issues owning those screens; this foundation does not certify every existing screen.

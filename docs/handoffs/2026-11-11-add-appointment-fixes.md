# Visit handoff — 2026-11-11, Add appointment fixes and a working swipe-down

PR #PR_NUMBER, built on `main` after PR #63. Read `2026-11-11-block-time-ui.md` first. Decisions: `decisions.md`, "Add appointment: errors under fields, a closable unknown outcome".

## Where things stand

- **Sheets close with a swipe down through `react-native-gesture-handler` 3.3** (`usePanGesture` in `FormDialog`), not `PanResponder`. Every `FormDialog` on a phone has it.
- **The Add appointment sheet marks wrong fields under themselves** (`manualFieldErrors` in `ManualBooking.utils.ts`; the view's `errors`). Required fields have a red "*" (`TextField` `required`, `RequiredMark`). `CompactBookingControls` takes `required`, `serviceError` and `timeError`; the customer booking flow passes none and looks as before.
- **An unknown save outcome no longer locks the sheet.** Try again resends the same attempt. Close clears it and reads the day again. Edit is hidden while the attempt is open.
- **The customer search has no retry button**; typing searches again.

## Lessons

- **"The app is stuck after saving" was the local database missing migrations, not the app.** The API ran PR #62's code, which reads `CustomerCard`, against a database without that table. Every save then failed with a 500 that the sheet treats as an unknown outcome, and every search failed. After pulling a migration, run `npm run db:deploy --workspace @visit/api` and restart `dev:api` before judging the app. Check with `select migration_name from _prisma_migrations order by started_at desc limit 3`.
- **`npx expo install` does not downgrade a package another dependency already pulled in.** `expo-router` had brought in Gesture Handler 3.4.0, so `package.json` said `~3.3.0` while 3.4.0 stayed installed. `npm install react-native-gesture-handler@~3.3.0 --workspace @visit/mobile` fixed it; `npm ls react-native-gesture-handler` shows the result.
- **Storybook (Vite) cannot pre-bundle Gesture Handler**: its native files import React Native's Flow sources. `.storybook/main.ts` excludes it from `optimizeDeps` (so its `.web.js` files are used) and pre-bundles `react/jsx-runtime`, which it then imports.
- **No full Xcode on the development Mac**, so the iOS Simulator tools refuse to start. Install Xcode and run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` to use them.

## Not verified

- **The swipe on a real phone.** Checked on web only, with real drags in the browser pane: a long drag from the title closes, a short one springs back, and a tap afterwards still works. On Android: open Add appointment, drag the handle down, then drag from inside the form while it is at the top. Both should close it; a drag while the form is scrolled down should only scroll.

## Debt

- **Required marks and field errors exist only in Add appointment.** The other forms (service, staff, business profile) still show one line, or no "*". `TextField` `required` and `RequiredMark` are ready for them.
- **After Close on an unknown outcome, retyping the same appointment can duplicate it** if the first one did save. The message says to check the day first.

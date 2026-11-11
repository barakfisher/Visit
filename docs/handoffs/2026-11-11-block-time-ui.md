# Visit handoff — 2026-11-11, Block time simpler, swipe-down sheets, home actions in one row

PR #63, built on `main` after PR #62. Decisions: `decisions.md`, "Block time simpler, sheets close with a swipe down, business home actions in one row".

## Where things stand

- **Block time asks "Who is unavailable" only with two or more active staff.** With one, the block is saved for the whole business (`staffId` null), not for that person.
- **A block's reason is chosen, never typed:** `BLOCK_REASONS` (break, meeting, errands, vacation, other), several at once. The form holds `reasons: BlockReason[]`; `blockInput` joins their labels in the owner's language, in offered order, into the existing `reason` text. No API or schema change. Blocks saved before keep their free text and show it as before.
- **Every phone bottom sheet (`FormDialog`) closes when dragged down**, from its handle or from content scrolled to the top. Thresholds: `SHEET_DISMISS_DISTANCE`, `SHEET_DISMISS_VELOCITY`. Dialogs at the compact breakpoint and up are unchanged.
- **The business home's Share and Block time are two equal `ActionButton`s in one row.** Block time is labelled "Time off" / "היעדרות".

## Lessons

- **The swipe was checked only on web, with synthetic mouse events in Storybook.** A short, slow drag springs back and a long one calls `onClose`. Native iOS and Android are not checked. On native, a `ScrollView` may claim the touch before the capture handler, so a drag that starts inside a long form could scroll instead of closing. Try it on a phone before relying on the content drag. The handle is the safe target.
- **Synthetic drags at 20 ms steps read as a flick** (over 0.8 pt/ms) and close the sheet at 60 px. Use slower steps in any automated swipe test.
- **Reading a sheet's position from the DOM in a hidden browser pane is stale.** Reanimated runs on `requestAnimationFrame`, which pauses there. A screenshot forces a frame.
- **`react-hooks/refs` forbids refs read inside a `PanResponder` built during render.** Gesture state that needs no render lives in Reanimated shared values (`drag`, `scrollTop`) instead.
- **Prisma's generated client is not in a fresh worktree, and `db:generate` needs `DATABASE_URL` set even though it never connects.** `DATABASE_URL=postgresql://unused@localhost:5432/unused npm run db:generate` makes `npm run typecheck` pass.

## Debt

- **Reason text is stored in the language of whoever saved it.** A Hebrew owner's "הפסקה, חופש" shows in Hebrew to an English-speaking manager of the same business. Codes plus translation at read time would fix it, at the cost of a migration and an API change.
- **"Other" carries no detail.** If owners want to say what "other" was, it needs a short text field shown only when "Other" is chosen.

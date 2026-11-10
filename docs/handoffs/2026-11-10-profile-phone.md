# Visit handoff — 2026-11-10, a contact phone on the profile, the admin card last, and a sign-out button (PR #56)

Supersedes `2026-11-10-appointments-cards-history.md` for current state. Its lessons and debt still hold unless corrected below. This work was done alongside the past-outcomes work (PR #55) on its own branch. Whichever merges second should check this file and `2026-11-10-past-outcomes.md` together.

## Authorization

The user's global working agreement governs. The user asked for the three Account changes, chose an unverified phone seen only by its owner, and chose a separate worktree, and asked for the PR (#56); merging was not asked for. The sign-out style was a recommendation they did not overrule. They have not seen it yet.

## Where things stand

- Account shows, top to bottom: language, the phone card (signed in only, once `/v1/me` has loaded), sign-in methods, Become a provider, System administration (admins only), Sign out.
- `Identity.contactPhone` (migration `20261110120000_identity_contact_phone`) stores an unverified E.164 number. The only writer is `PUT /api/account/contact-phone`, and the only reader is `/v1/me`. It is not unique, and nothing that serves a business reads it.
- Sign out is the secondary danger `ActionButton` with `SignOutIcon`.

Reasoning: `docs/architecture/decisions.md`, "Profile: a contact phone, the admin card last, and a sign-out button — 2026-11-10".

## Lessons (these will recur if forgotten)

- **There are two phones on an identity.** `phone` is a unique sign-in method that needs an SMS code. `contactPhone` is whatever the person typed. When verification arrives, verifying `contactPhone` should run through the existing contact-challenge protocol and move the number into `phone`, not mark `contactPhone` as verified in place. Otherwise two columns would each claim to be the verified number.
- **Any new `select: { ... }` or `include: { identity: true }` that reaches a business must not carry `contactPhone`.** The security review (bf-security-reviewer, static) found no exposure. `provider-review.ts` was narrowed from `include: { identity: true }` to the three fields it uses. Other whole-row identity reads stay on the server and return only ids or derived values. A future `return` of one of them would leak the number.
- **`native-direction.test.ts` requires `...physicalDrawing` on every View with a border on one side only, nested Views included.** A mirrored icon flips with `scaleX`, not by swapping its borders.

## Debt worth knowing

- **Not run on a phone.** The phone keyboard (`phone-pad`), the icon on native under RTL, and the bottom spacing above the footer are unverified on a device. They were checked in the browser at 375px (Hebrew) and 1280px (English).
- **The web smoke scripts were not run.** They find sign-out by its name, "Sign out", which did not change.
- **Two tabs can overwrite each other's number.** The last save wins, with no conflict check. This is acceptable for a field only one person edits.

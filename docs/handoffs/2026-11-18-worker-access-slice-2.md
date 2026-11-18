# Visit handoff — 2026-11-18, worker access slice 2 (invitation tied to a staff row) (PR #72)

Built on `main` after PR #71. Decisions: `decisions.md`, "Invitations tied to a staff row".

## Authorization

The user's global working agreement governs. The parent session asked for slice 2; the one design question (removing a row with active app access) was answered by the user's instruction "create pr merge and continue until the part we have discussed is done, don't stop for questions", so the recommended option A was taken and recorded. The same message asked for this PR and its merge.

## Where things stand

- An invitation can name one staff row; accepting links the membership to it (`Membership.staffId`, `BusinessInvitation.staffId`, migration `20261118120000_staff_linked_access`).
- Roster cards show *Not invited / Invite pending / Active · {account} · {role}*, with *Invite to app*, *New invite link*, *Cancel invitation* and *Remove app access*. The invite screen says "Join {business} as {staff}". Team access shows each member's and invitation's calendar.
- Staff still has no permission: a linked worker gets no provider workspace. Slice 3 (My day) is next; read "Open before slice 3" in worker-access.md first, which gained two items from this slice.

## Lessons

- **A calendar linked to an owner would be stuck forever.** Owner access is never revocable, and a row with active access cannot be removed, so accepting a calendar invitation as an owner is refused (`INVITATION_OWNER_LINK`). Any future "link an existing member" path must keep that rule.
- **A replacing write must respect the revoke rules.** "One live link per calendar" revokes the previous invitation; without the `permittedInvite` check a manager could cancel an owner's Manager invitation by sending a new link.
- **Reactivation rewrites the link.** `Membership` is unique per identity + business + role, so accepting reactivates an old row; the upsert always writes `staffId` for a non-active row, or a revoked calendar link would come back.
- **Partial unique indexes live only in the migration.** Prisma cannot express them; `prisma migrate diff` against the database proposes nothing for them (checked), but never "fix" drift by regenerating that migration.
- **The worktree used its own database** (`visit_slice2` on the shared container) so the main checkout's `visit` database stays on `main`'s schema. Browser checks ran on 127.0.0.1 ports 3002/8085 so their cookies never touch a localhost session.
- **A broad `sed` on the schema changed an unrelated relation** (`Booking.customerCard` Restrict → NoAction); `bf-qa` caught it and it was reverted. Edit schema relations one by one.

## Not verified

- **Checked:** API full suite 421/421 (`staff-linked-access.test.ts`: invite with a row, accept links, wrong recipient, archived row, row already linked, concurrent accepts, cross-business row at API and DB, manager cannot replace an owner's link, owner never linked, remove access keeps row, hours and bookings, row removal refused while linked, no provider workspace after linking); mobile foundation 232/232 (`staff-access.test.ts`); StaffRoster stories 13/13 (badges, invite form, remove confirmation, axe); typecheck and lint clean. Browser pane at 375px in Hebrew RTL against a real API: invite → pending badge → worker accepts "הצטרפות למספרת דנה בתור נועה" → Active badge → row removal refused with an alert → Team access "יומן: נועה" → remove app access → Not invited. `bf-security-reviewer` (one Low finding, fixed) and `bf-qa` (one blocker and three small issues, fixed).
- **Not checked:** English layout in the browser (strings exist and stories cover English); the invite screen's `staffRemoved`, `staffLinked` and `ownerLink` messages in the browser (covered by API tests only); native iOS/Android.

## Debt

- `tsconfig.test.json` typecheck is still red on `main` at `test/booking-operations.test.ts:140` (unchanged).
- The team listing now returns members' display names to Owner and Manager (business-access.md updated).
- "Remove app access" on a card revokes every subordinate role the person holds in the business, not only the linked one; the confirmation says so.

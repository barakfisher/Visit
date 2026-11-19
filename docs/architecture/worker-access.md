# Worker access (design; slices 1–4 built)

Agreed with the user on 2026-11-18. Today a STAFF invitation grants a membership that opens nothing, and it is not tied to any calendar (business-access.md). This design gives an invited worker their own calendar in the app.

## User types

| Type | Is | Sees |
| --- | --- | --- |
| Customer | Any signed-in identity | Their own bookings and saved providers |
| Platform admin | `PlatformRole` | Applications and ownership review |
| Owner | `MembershipRole.OWNER` | The whole business |
| Manager | A member with all four switches on (see Privileges) | The whole business, except removing an owner or changing switches |
| Worker | A member with fewer switches, linked to one staff row | Their own calendar, plus whatever their switches add |

Every type keeps customer capability. A worker switches between customer and provider mode the same way an owner does.

## Owner flow

1. **Roster** stays the main team screen. Each staff card gets an access badge: *Not invited*, *Invite pending*, *Active · {account name}*.
2. **Card → Invite to app:** role (Worker or Manager) and the recipient's email or phone → private link to copy and share, as today, but the invitation carries that staff row.
3. **Active card → Remove app access:** revokes the membership; the staff row, its hours and its bookings stay. Removing the staff row is a separate action, as today.
4. **Team access** stays for people without a calendar (for example a receptionist Manager) and shows which calendar each member is linked to.

A one-person business adds itself to the Roster ("Add myself") and never needs Team access.

## Worker flow

1. **Invite:** "Join {business} as {staff name}" → Accept. Accepting links the account to that staff row.
2. **My day** (worker home in provider mode): their own agenda, day and week.
3. **On their own calendar only:** add, move and cancel appointments, block time, mark outcomes (completed, no-show).
4. **Customer search:** all of this business's customer cards, so a worker booking a new client or a colleague's client finds the existing card instead of creating a duplicate.
5. **Notifications:** booking, move and cancellation on their own calendar. Owners and managers keep receiving every one, as today.
6. **Not shown:** business settings, services, prices, publication, other workers' calendars, Roster, Team access.

## States to cover

- Invite for a staff row that was removed, or already linked to another account: the link fails closed with a clear message.
- Worker whose access was removed: the next read returns to customer mode, like a removed manager today.
- Worker linked to a staff row marked unavailable: My day shows their existing appointments and says new bookings are off.
- My day loading, empty day, and read failure with retry, as the business home does today.
- A worker opening another worker's appointment or calendar by URL: not found, never the data.

## Privileges

Four switches per member. The role picked at invite (Worker or Manager) only sets their starting values; afterwards the switches are the single source of truth.

| Switch | Worker preset | Manager preset |
| --- | --- | --- |
| See other workers' calendars | Off | On |
| Act on other workers' calendars (add, move, cancel, block) | Off | On |
| Business setup (services, prices, hours, booking policy, publishing) | Off | On |
| Manage team (invite and remove members) | Off | On |

- A member always has full control of their own calendar; no switch removes it.
- The Owner is always everything and has no switches.
- **Only the owner changes switches**, on the member's card (Roster or Team access). Nobody changes their own.
- The card label comes from the switches: *Manager* when all four are on, otherwise *Worker* plus the extra permissions it has.
- Migration: every current MANAGER gets all four on, every STAFF all four off, so no one's access changes on the day.
- The server replaces its Owner/Manager checks (58 in 18 files when measured) with one function answering "can this member do X in this business". This is security work and needs `bf-security-reviewer`.
- *Act on other calendars* needs *See other calendars*; turning one changes the other in the editor, and the server refuses the pair otherwise.
- A member with no calendar opens provider mode only with *See other calendars*.
- A *Manage team* holder invites only Workers and removes only members with fewer switches than their own.

## Parked (later decisions)

- **One worker at several businesses:** each link is business + staff row + account, so a second business is a second link, and provider mode already switches between businesses. Not designed further yet.

## Build plan

Measured 2026-11-18: `Membership` has no staff link and `Staff` no account link; `Membership` is unique per identity + business + **role**, so one person can hold several rows in one business; Owner/Manager checks sit in 18 files, 19 of them in `routes/providers.ts`. One PR per slice, each with UI + API + data + tests.

1. **One permission check, no behaviour change.** A single function answers "can this member do X in this business" for the actions own calendar, other calendars (see / act), business setup, manage team, change switches. For now it derives answers from today's roles. Every Owner/Manager check moves to it. *Done when:* the existing API suite passes unchanged and a matrix test covers each action × Owner/Manager/Staff/outsider/other business. `bf-security-reviewer`.
2. **Invite tied to a staff row.** *Built in PR #72; removing a row with active app access is refused until access is removed (decisions.md, "Invitations tied to a staff row").* `Membership` gains an optional staff link (one account per staff row per business); the invitation carries the staff row; accepting links it. Roster cards show the access badge and *Invite to app*; *Remove app access* keeps the row and bookings. *Done when:* the invite, accept, remove and fail-closed states above work in the browser, in Hebrew RTL. `bf-security-reviewer`.
3. **My day for a worker.** *Built in PR #73 (decisions.md, "My day for a worker"); only the owner links calendars, and a worker reads only what booking on their own row needs.* Provider mode for a linked worker opens their own agenda; add, move, cancel, block and outcomes on their own staff row; customer search across the business. The server scopes every worker action to their linked staff row. *Done when:* a worker cannot read or change another row by URL or API, and the states above are covered. `bf-security-reviewer`, `bf-qa`.
4. **Worker notifications.** *Built in PR #74 (decisions.md, "Worker notifications"); a move between rows tells both workers, and outcomes are not sent to workers.* Booking, move and cancellation on a worker's row also notify that worker; owners and managers unchanged. *Done when:* one notification per recipient, none for a removed worker.
5. **Switches.** *Built in PR #77 (decisions.md, "Switches"); act needs see, a member without a calendar counts only with see, and an invitation to an active member only links a calendar.* One membership per person per business; four stored switches; migration from roles to presets; the permission check reads switches; the owner edits them on the member's card; the label derives from them. *Done when:* the migration changes no one's access (tested), only the owner can change switches, nobody their own. `bf-security-reviewer`.

Slices 1–4 deliver the worker; 5 delivers editable privileges. Each slice is mergeable on its own.

### Open before slice 3 (resolved in PR #73)

Each item is answered in decisions.md, "My day for a worker":

- **Business-wide blocks** need BUSINESS_SETUP; a worker sees them read-only.
- **Manual booking that touches customer cards** also needs SEARCH_CUSTOMERS.
- **Settings, service list and one service** need BUSINESS_SETUP; a worker gets `manual-booking-options` narrowed to their own active row.
- **The profile's business list and `permittedInvite`** follow the permission table (`mayGrantRole`).
- **Linking calendars** is the owner's alone (`LINK_CALENDARS`); a manager's older calendar invitation fails at accept.
- **Owner's own calendar:** never linked, no My day; the owner filters the whole-business agenda to their row.
- **Write paths in the matrix test:** one refused write per permission.

### Open before slice 4 (resolved in PR #74)

- **Moving an appointment has no provider UI**, for an owner either. Slice 4 assumes no screen: a move notification opens the business home like any other business notification.

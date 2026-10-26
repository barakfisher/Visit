# Existing-business access (VIS-33)

## User journeys

Business setup → Team access → choose Staff or Manager and a recipient's verified email/phone → create a private invitation → copy and share directly. The raw link is shown once. Creating another invitation to the same contact/role revokes the previous pending link; a lost response is recovered by issuing a fresh link.

Recipient opens `/invite#invite=<opaque>` → URL is scrubbed → explicitly reviews the business/role → explicitly accepts. Opening or previewing never grants membership. Signed-out recipients sign in and reopen the original link; credentials are not persisted in browser storage, query keys, return URLs or logs. The token stays only in screen memory and is cleared on account change/unmount/acceptance. Network ambiguity requires checking the account or requesting a fresh invitation; consumed tokens cannot resurrect revoked access.

Owners invite Manager or Staff. Managers invite Staff. Staff cannot manage access; there is no Owner invitation option. Invitations never link a Staff scheduling resource to a person's account, and Staff access does not promise a management dashboard. Approved Owner/Manager memberships refresh the unified account's provider mode, while preserving customer capabilities. Multiple roles for a business resolve to one mode choice, with Owner priority.

Team access allows removal of subordinate access with confirmation. It revokes all subordinate memberships for that identity in this business and pending invitations issued through them. Owner access cannot be revoked here, preventing last-owner lockout. A Manager cannot remove someone who also holds Manager/Owner rights. Other businesses, other identities, existing bookings and publication are not changed.

## Ownership review

Admin Applications → Verified ownership cases. A recently authenticated administrator records an existing approved business, independent claimant with verified contact, unique evidence case reference, evidence type and summary. Supported evidence: consent from the current owner, authoritative registration records, or reviewed platform records. Human verification happens outside the app; this is a recorded review, not automatic proof of legal ownership. Do not store documents or secret credentials in evidence text; use an access-controlled case reference.

A reasoned approval, with explicit confirmation, adds/reactivates only the claimant's Owner membership. Existing owners are preserved. Rejection grants nothing. Current administrator role, session and claimant security version/contact are rechecked at commit. Identity/contact changes require a new reviewed evidence case. Creator/reviewer cannot be the claimant. Decisions and evidence become immutable; amendments require a new case. No public arbitrary-business Owner claim route is enabled.

## Security and transaction boundary

- 32 random bytes encoded as a 43-character opaque capability; SHA-256 token digest only at rest. Recipient binding is a domain-separated HMAC of normalized verified primary email or E.164 phone; list projection includes a masked hint only.
- 72-hour lifetime; DB requires positive lifetime ≤7 days, valid role/channel/digests and consistent terminal states. Composite inviter membership/business/identity FK prevents cross-tenant parents.
- Privileged mutations and invitation acceptance require authentication within five minutes, with session-family lock, current session recheck and identity security lock. Business row lock serializes invitation consumption/revocation, membership revocation and ownership grants. The original inviter membership and role must still be active/eligible. Invitations are consumed once; simultaneous acceptors produce one grant/audit event and one conflict.
- Invitation creation: 30 attempts per identity/hour in Redis (fail closed on outage) and at most 100 live pending invitations per business. Preview/accept requires authenticated identity and a cryptographically unguessable token; responses do not reveal the target business to a mismatching recipient.
- Append-only access events record actor, subject, membership, business, role, action, timestamp and invitation/case reference. DB rejects event updates; restricted parent deletion preserves review records. Explicit fixture cleanup deletes only its own audit rows. Production retention/deletion remains an operational policy in the security release gate.
- Application middleware enforces trusted-origin cookie writes and no-store responses. Log serializers exclude bodies, queries and credentials. No invitation email/SMS is sent; managers copy and share links themselves.
- Unlike business configuration edits, these operations never run publication readiness changes or expire customer holds.

## Verification

`npm run db:generate --workspace @visit/api` and `npm run db:deploy --workspace @visit/api` apply migrations 21/22 after the existing 20. Source and tests: repositories/business-access.ts, routes/business-access.ts, test/business-access.test.ts; mobile scripts/business-access-smoke.ts and test/invitation-token.test.ts.

The API suite bounds file concurrency to two against the shared local PostgreSQL/Redis. Intratest acceptance/review races remain concurrent. This avoids unrelated DB suites saturating transaction deadlines, observed when running all files plus Storybook simultaneously. Failed unbounded run: publication availability request returned 500 followed by cascading fixture-state failures; publication recheck passed 10/10 in isolation. Record the final bounded suite results in the delivery evidence.

Web smoke covers owner creation, manager-only Staff choice, matching-recipient consent, wrong-recipient denial, fragment scrubbing/no URL credential requests, member/invitation revocation, admin evidence and Owner grant, preservation of publication and Hebrew RTL. Native JS exports are build evidence only. Actual installed deep links and OS/browser behavior remain the VIS-2/VIS-43 release gate; HTTPS association files/Android invite link configuration require staging/device verification before claiming universal-link support.

### Final local evidence — 2026-10-26

- 171/171 API tests passing with bounded file concurrency, including nine invitation/access test cases.
- 31/31 mobile foundation tests and 55/55 Storybook tests passing.
- Complete exported-web Playwright suite passing against PostgreSQL/Redis; invitation assertions also check history/local/session storage and the URL after preview/acceptance.
- Workspace typecheck/lint, API fixture/security test-source typecheck, clean diff check and Prisma status passing (22 applied migrations).
- iOS and Android JavaScript exports passing. No installed-device or live-delivery claim.
- GitHub hosted CI has been blocked by account billing/spending restrictions on prior PRs; check the current run before merge and record it separately from local evidence.

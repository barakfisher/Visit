# Provider application review — VIS-32

One identity remains a customer throughout applying, approval and rejection. `/register/provider` authenticates first and then displays the application form/status. Account links to that same surface. The subsequent VIS-46/VIS-27 menu/mode work consumes this flow; no automatic provider-dashboard redirect is added.

## New applications and legacy ownership claims

New-business creation sets `kind=NEW_BUSINESS`, a pending owner membership and the exact pilot timezone. The former arbitrary `businessId` → owner application path is rejected with `INVITATION_REQUIRED`. Existing applications migrate conservatively to `LEGACY`; admin decision controls stay disabled pending verified ownership review (VIS-33). Old requests never silently become a trusted new-business claim.

## Review authorization and concurrency

The pending admin queue is available only to stored ADMIN identities, returns at most 100 oldest requests, and reloads after each decision so the next batch becomes available. New-business approval/rejection requires a trimmed 5–1000 character reason shown to the applicant. A fresh five-minute authenticated admin session is required; its family/session and the admin identity are rechecked/locked inside the transaction. Business/application row locks serialize competing decisions. The transaction changes only the applicant's pending owner membership, records reviewer ID/time/reason and creates one unique notification event. Same decision/reason retries return the recorded result; conflicting or stale decisions return conflict. Revoked/missing target membership and changed business approval state fail without partial writes.

Approval never sets `Business.publishedAt`. Existing businesses receive null publication metadata in this additive migration; no appointment data is moved or deleted. **VIS-34 immediately follows and owns enforcing published-only public/booking access on all modern/legacy paths. Existing approval-only public eligibility is not certified by this issue.**

## Notifications and truthful status

The unique application event is created in the review transaction. The worker uses leases and `FOR UPDATE SKIP LOCKED`, five bounded attempts, retry timing and a stable provider idempotency key. Decision persistence does not depend on the email provider. Only a verified email is queued, and a changed/unverified contact falls back to in-app status. Recipient snapshots expire after seven days. Phone-only applicants see their reason/status in-app. The status endpoint is scoped exclusively to the authenticated identity; it never returns the stored destination or another applicant's request.

`LOCAL` means local inbox recording, not email sent; `ACCEPTED` means provider acknowledgement, not delivery confirmation. `BLOCKED`/`FAILED` remain visible with in-app fallback. The Resend adapter uses plain-text localized templates, request timeout, fixed endpoint and sanitized errors. Delivery is at least once with provider deduplication, not a claimed distributed exactly-once guarantee. Local/browser tests use synthetic delivery; no real notifications were sent as verification.

## Administrator bootstrap

Public sign-in never grants ADMIN from an email allowlist. A trusted DB operator reviews identity ownership and runs from `apps/api`:

```
../../node_modules/.bin/tsx scripts/promote-admin.ts --identity ID --operator OPERATOR --reason REVIEWED_EVIDENCE_REFERENCE --confirm
```

The command requires a verified identity contact, explicit identity ID (not lookup by released email), operator and evidence reference. It locks identity security, writes `AdminRoleAudit`, promotes once and revokes existing sessions; the administrator signs in again. No public promotion endpoint exists. This command was tested with synthetic identities through the shared promotion function; no real account was promoted. An operator must choose and verify the actual pilot administrator before operations.

`AdminRoleAudit` is a global operator audit with no customer API. `ProviderReviewNotification` is business-owned through its application; reads use applicant identity ownership or admin authorization. Application status/reason remains available when email is absent or fails. Operational retention of the business audit and real mail delivery remain pilot operations checks.

## Reproduction

- `npm test --workspace @visit/api`: admin/foreign/missing-reason negatives, competing decisions, replay, intended membership, unchanged publication metadata, stale session, legacy ownership rejection, notification retry/failure, concurrent worker lease and audited bootstrap.
- Root typecheck/lint; mobile foundation suite; browser suite against actual API/PostgreSQL/Redis.
- Browser test submits a new application, reviews it from a synthetic admin session with a required reason, refreshes applicant status and checks the intended active membership and null publication metadata. Existing auth, tenant, booking and DST regressions remain enabled.

Actual native execution and real transactional email delivery remain VIS-2/VIS-43 pilot gates. GitHub-hosted CI may remain unavailable due to the previously reported account billing/spending restriction; record actual PR check results separately.

Local evidence on 2026-10-25: 137 API tests, 25 mobile foundation tests, 47 Storybook checks, full browser regression suite, root typecheck/lint and iOS/Android bundle exports passed. Browser screens were captured and visually inspected. Native exports are compilation evidence only.

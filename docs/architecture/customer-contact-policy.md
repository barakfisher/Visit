# Business-required customer contact (VIS-36)

Businesses independently require a customer name, verified phone, verified email, or any combination. Policy saves preserve omitted flags for older clients. Contact-rule changes take the business configuration lock, expire provisional holds transactionally, and release Redis ownership after commit. Confirmed history and publication remain separate.

The authenticated contact-readiness endpoint returns only the caller's profile and the selected published business's requirements. The strict own-profile PATCH accepts only a bounded display name. Public provider links expose no private contact profile. Contact completion reuses the existing recent-authentication, exact-session, identity/security-version-bound, expiring, single-use verification protocol. Verifying a contact explicitly also adds an account sign-in method; unavailable delivery stays disabled.

Booking choices remain advisory while required contact is missing: name editing and OTP entry create no hold. Same-identity contact rotation retains service/date/selected instant while discarding private holds. Recent-authentication recovery uses a validated local return target and an identity/provider-bound memory-only advisory draft; it contains no credentials, proofs or reservation ownership and is consumed or cleared on account change/logout. UI presentation and orchestration live in separate component/hook files.

PostgreSQL's migration23 contact trigger is authoritative for HELD and newly CONFIRMED writes, including future provider-entered appointments. It reads the current policy and identity evidence under row locks, rejects missing/unverified requirements, overwrites caller-supplied contact assertions, captures verified operational contacts on first confirmation, and protects captured snapshots and customer ownership. API errors map to recoverable CUSTOMER_CONTACT_REQUIRED conflicts. Existing confirmed history is not backfilled with invented verification. Provider agenda reads the captured contact snapshot rather than later identity edits.

Manual entry policy: customer-assisted verification through the same identity-owned proof protocol is required. A provider cannot invent verification or tick an override checkbox. The provider-entered appointment UI remains VIS-38.

## Independent review

QA agent reviewed the diff and SQL, added 13 API unit tests and 3 advisory-draft unit tests. Its reauthentication-context finding was fixed and covered by the aged-session browser journey. Checks include all requirement combinations, null/empty/whitespace name, orphaned timestamps, missing proofs, typed errors, strict forged flags, mutation isolation, legacy policy omissions, exact slot instants, replacement and idempotent draft cleanup.

Security agent performed static source/diff inspection and a follow-up on draft recovery. No actionable vulnerability was identified. It reviewed strict profile input, caller-only readiness, tenant management locks, immutable snapshots, contact proof/session binding, agenda authorization, no-store headers and restricted return targets. Security review did not independently execute runtime/database checks or live delivery integrations.

## Verification

Final local verification (2026-10-26):

- `NODE_ENV=test npm test --workspace @visit/api`: 191 passing.
- `npm run test:foundation --workspace @visit/mobile`: 37 passing.
- `npm run test-storybook --workspace @visit/mobile`: 55 passing.
- `VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile`: complete exported-web regression passed, including aged-session contact completion and zero writes during verification.
- `npm run typecheck` and `npm run lint`: passed.
- API `tsc -p tsconfig.test.json --noEmit`: passed, including the new contact tests; Prisma reports all 23 migrations applied.
- Expo iOS and Android JavaScript exports: passed at `/tmp/vis36-native-final`.

 Browser delivery boundaries are synthetic local fixtures. JavaScript iOS/Android exports do not establish installed-native behavior. Hosted Actions billing and the VIS-2 → VIS-43 → VIS-25 native pilot gate remain separate from local verification.

The browser harness accepts VISIT_TEST_WEB_PORT and probes all interfaces before binding, so it cannot silently reuse an old IPv6 listener. This run uses 8083 and preserves the pre-existing orphaned Expo server on 8082, alongside the user's API3000/Metro8081 runtimes.

Implementation PR: https://github.com/barakfisher/Visit/pull/10. Code commit: a687a9f60976f25268dd8bf137c6a833be853ea3. Hosted Actions run40286794028/job121452234512 executed zero steps: GitHub reported failed account payments or spending-limit configuration. This is not passing hosted CI; ordinary merge uses separately recorded local evidence.

# Security Checklist — Z-float

Live checklist for releases, changes, and incident response. Work through top to
bottom. Anything unchecked is a release blocker.

## A. Secrets & Configuration

- [ ] No production credentials, API keys, or passwords in source code, seed
      scripts, tests, or documentation.
- [ ] `.env` never committed; `.env.example` contains placeholder values only.
- [ ] Production secrets injected via the platform secret manager (env vars),
      never baked into Docker images.
- [ ] `ADMIN_PASSWORD` and `MPESA_*` / `AIRTIME_API_KEY` values are not logged.
- [ ] Demo login (`demo@zfloat.app`) is disabled when `NODE_ENV=production`
      (seed refuses to run; auth route must reject demo credentials in prod).

## B. Authentication & Session Management

- [ ] Passwords hashed (argon2/bcrypt-class) — never plaintext or reversible.
- [ ] Login rate limiting / lockout on repeated failures.
- [ ] Session cookie: `HttpOnly`, `SameSite=Lax`, secure in production.
- [ ] MFA enrollment supported and enforced for admin roles where configured.
- [ ] Session invalidation on password change and on logout.

## C. Authorization & Tenant Isolation

- [ ] Every query and mutation is tenant-scoped (`tenantId` in WHERE clauses);
      no cross-tenant reads possible via the API.
- [ ] RBAC enforced server-side on every action (`loadUserPermissions` +
      permission checks in routes and domain functions).
- [ ] Platform-admin endpoints require `requirePlatformAdmin()`; no business
      user can reach admin APIs.
- [ ] Tenant isolation test suite passes (see `apps/web/tests/tenant-isolation.test.ts`).
- [ ] User-uploaded files are scoped per tenant; S3 keys never guessable
      (server-generated names).

## D. Payments & Ledger Integrity

- [ ] All monetary values are integer minor units (bigint) end-to-end; no float
      arithmetic on settlement-critical amounts.
- [ ] Idempotency keys enforced on create/submit/approve (unique constraint +
      `withIdempotency` guard); replays return the stored result.
- [ ] Payment state changes only via the legal state machine
      (`transitionPayment`); illegal transitions throw.
- [ ] Reservations are atomic; insufficient funds fail the payment, never
      overspend the wallet.
- [ ] Ledger is double-entry and immutable: journals balance (debits =
      credits), historic entries are append-only (DB trigger blocks
      UPDATE/DELETE), reversals are new entries.
- [ ] Fees are snapshotted at create time (fee_versions); admin price changes
      never retroactively alter pending payments.
- [ ] Provider timeouts are treated as "unknown outcome", never as failure;
      the monitor reconciles stuck payments (monitorStuckPayments).

## E. Webhooks & Provider Callbacks

- [ ] Pipeline order is fixed: verify → persist raw event → dedupe → enqueue →
      apply legal transition → ledger → notify → ack.
- [ ] Webhook replay protection: unique `provider_event_id` index + visible
      duplicate check; replays ack `duplicate` and never double-execute.
- [ ] Webhooks for unknown payments create exactly ONE reconciliation orphan
      (UNMATCHED), then stop retrying.
- [ ] Signature verification before any side effect; unverifiable webhooks are
      rejected (raw payload kept for forensics).
- [ ] Provider adapters are fail-closed: missing credentials throw
      `PROVIDER_AUTH_FAILED` instead of guessing endpoints.

## F. Data Protection & Logging

- [ ] No secrets or PII in logs (payment numbers, IDs, and generic messages
      only; beneficiary details are snapshotted, not logged).
- [ ] Personal data handled per applicable law (ODPC-aligned principles);
      consent records stored (`consent_records`).
- [ ] Uploads scanned (clamd in production; mock scanner in dev) before parsing.
- [ ] Audit trail for all financial + admin actions (`audit_events`).
- [ ] Backups encrypted at rest; restore drill exercised (see runbooks).

## G. Application Security

- [ ] Untrusted upload content is never executed; CSV/XLSX parsed server-side
      with schema + row validation and row-level errors.
- [ ] No raw SQL from user input; drizzle parameterized queries only.
- [ ] Dependency audit clean (`pnpm audit`) or deviations documented in
      KNOWN_LIMITATIONS.md.
- [ ] Security headers set on the web app (CSP, X-Frame-Options, etc.) in
      production config.
- [ ] Malware-scan driver selection validated against an allowlist
      (`MALWARE_SCANNER_DRIVER`).

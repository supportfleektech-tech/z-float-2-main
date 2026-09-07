# Penetration-test runbook (Z-float)

Defined-scope security testing plan. **Authorized scope only**: the staging
or local demo environment (`NODE_ENV=staging`/`development`, DEMO_MODE), with
real-provider credentials removed. Never run against production without a
written authorization that names systems, dates and testers.

## 1. Preparation checklist

- [ ] Stand up an isolated environment: `pnpm db:reset && pnpm db:seed` on a
      disposable database, web + worker + relay running (RB-02, RB-12).
- [ ] Export the environment: `source .env` (demo creds only).
- [ ] Record the baseline: `pnpm evidence` (compare post-test `audit-events`
      and `security-events` — every action is logged, so a test run is itself
      auditable).
- [ ] Notify the team of the window (worker logs will show the traffic).
- [ ] Test accounts: demo owner `demo@zfloat.app`, platform admin
      `admin@zfloat.app`, seeded roles (maker/approver/finance) — plus one
      throwaway user for lockout tests.

## 2. Scope map (OWASP Top 10 → where it is exercised)

| Area | Target | How to test | Expected (product guards) |
|---|---|---|---|
| A01 Broken access control | `/admin/*`, RBAC API guards | hit admin routes as demo user; PATCH payment as viewer | 403; E2E `unauthorized users are blocked from admin` |
| A02 Cryptographic failures | sessions, keys, provider secrets | inspect env for dev defaults; check vault config | `SESSION_SECRET` min 32 chars; zero `ENCRYPTION_KEY` refused in prod; C2 vault |
| A03 Injection | search/import/statement endpoints | fuzz `action=`/`resourceId=`/CSV import cells | drizzle parameterized queries; idempotency keys; reconciliation import validation |
| A04 Insecure design | approvals, double-spend | submit same payment twice concurrently; approve without permission | reservation atomicity (ledger C-3), maker-checker policy engine |
| A05 Security misconfiguration | headers, cookies, error bodies | inspect responses; trigger 500s | `COOKIE_SECURE` in prod; apiError JSON without stack traces |
| A06 Vulnerable components | dependencies | `pnpm audit` (evidence artifact) | CI gate; dependency-audit.txt in every evidence run |
| A07 Auth failures | login, MFA, invites | brute force login; replay MFA code; use expired invite token | rate limit + lockout (`login_events`), TOTP replay window, invite expiry + raw-token flow |
| A08 Integrity failures | webhook endpoints, files | replay a webhook body twice; upload polyglot/malware doc | dedupe (webhook replay E2E), ClamAV scan → CLEAN/INFECTED |
| A09 Logging failures | audit coverage | perform a mutation, confirm audit row | append-only `audit_events` with before/after; immutable tables |
| A10 SSRF | provider/webhook URLs | point `MPESA_API_BASE_URL`/webhook subscription at internal hosts | sandbox-only override refused in production config |

## 3. Financial-correctness tests (payment-specific)

- [ ] Double-spend: two `submitPayment` for the same payment id → exactly one
      reservation (integration-proven; repeat against API).
- [ ] Insufficient balance: pay more than available → payment FAILED, wallet
      untouched, `RESERVE_DENIED` ledger row written (SQL:
      `SELECT * FROM wallet_ledger_entries WHERE entry_type='RESERVE_DENIED'`).
- [ ] Journal integrity: attempt `UPDATE journal_entries` → blocked (trigger).
- [ ] Webhook replay: same provider payload twice → second acked `duplicate`
      with no double execution (E2E `Tier-1 webhooks`).
- [ ] Idempotency: repeat a public-API call with the same idempotency key.

## 4. Reporting template

```
# Pen-test finding — ZF-<NNN>
Severity: (critical|high|medium|low)      CVSS: x.x
Component / endpoint:
Steps to reproduce:
Observed:          Expected:
Evidence (audit row / security event id / request-id):
Remediation:       Owner:      Target date:
Retest: (date + result)
```

Every finding must reference the immutable audit/security row that captured
it — the product's audit trail is the retest evidence.

## 5. Remediation SLA

| Severity | Fix window | Gate |
|---|---|---|
| Critical | 24h | deploy freeze lifted after fix + full gate |
| High | 7 days | same |
| Medium | 30 days | scheduled |
| Low | next release | tracked |

Close-out = new `pnpm evidence` run + updated `security-events` rows + this
runbook's retest column completed.

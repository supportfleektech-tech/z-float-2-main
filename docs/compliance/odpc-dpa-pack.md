# ODPC DPA compliance pack (Kenya, Data Protection Act 2019)

For a Z-float entity acting as **data controller** (payments platform) with
**data processors** (hosting, comms gateways). Update the register details
below to the registered entity before an audit or DPA submission.

---

## 1. Records of processing activities (Art. 29 / Sec. 25 DPA)

| Processing activity | Personal data categories | Purposes | Lawful basis | Retention | Recipients/processors | Evidence |
|---|---|---|---|---|---|---|
| Account & RBAC | identity, email, phone, roles, MFA factors | operate the account, access control | contract (Sec. 26(a)); legal obligation for AML records | account life; logs per policy | hosting processor | `access-review.csv` |
| Payment execution | business identity; beneficiary names/phones for M-Pesa/bank | execute payments | contract; legal obligation (AML, CBK records) | payments + audit records per statutory retention | M-Pesa/Daraja, bank PSP, airtime aggregator | `audit-events.csv` |
| KYC / verification | identity documents (special category per DPA: national ID, passport, likeness) | AML watchlist screening, fraud prevention | legal obligation; explicit consent | per verification policy + watchlist duration | doc-scan (ClamAV local), watchlist feed | `kyc-scan-status.csv`, `verification_documents` |
| Consent management | purpose + timestamp + grant/revoke | demonstrate lawful processing | consent (Sec. 26(c)) — withdrawable | 7 years after last activity (evidence policy) | — | `consent-records.csv` |
| Notifications (email/SMS) | email, phone, message content | operational + marketing (separate consent) | consent (marketing) / contract (operational) | as messages policy | SMTP/SMS gateway processors | `notification_templates`/`notifications` |
| DSAR fulfilment | all of the above | respond to data subject rights (Sec. 26/27) | legal obligation | 30-day SLA (see §4) | — | `data-requests.csv` |
| Security & audit | IP, user-agent, actions, before/after snapshots | security monitoring, accountability | legitimate interest (Sec. 26(h)) | audit tables append-only, immutable | — | `audit-events.csv`, `login-events.csv`, `security-events.csv` |

Special categories: KYC identity documents are sensitive personal data —
processed under explicit consent + legal obligation, encrypted at rest via
object storage driver (S3 SSE in production), scanned for malware before
review, access restricted to compliance roles.

## 2. Data inventory → system mapping (for the DPA annex)

- **Identities**: `users`, `invitations`, `sessions`, `mfa_factors` (encrypted
  secrets), `api_keys` (hashed only).
- **Financial**: `tenants`, `business_accounts`, `wallets`, `payments`,
  `beneficiaries`, `funding_events`, `journals`/`journal_entries` (immutable),
  `wallet_ledger_entries` (immutable), `recon_*`, `reports`/`report_schedules`.
- **KYC**: `kyb_cases`, `kyc_subjects`, `verification_documents`
  (object-store payloads), `consent_records`, `data_requests`.
- **Comms**: `notification_templates`, `notifications`, `webhook_events`,
  `webhook_subscriptions`.
- **Audit/security**: `audit_events`, `login_events`, `security_events`,
  `admin_changes`.

## 3. Data Protection Agreement (processor terms) — summary clauses

For each processor contract (hosting, SMS/email, M-Pesa aggregator, watchlist
feed), require:
1. Processing only on documented instructions (controller remains Z-float).
2. Confidentiality obligations on processor personnel.
3. Sub-processor list + prior notice; flow-down of these terms.
4. Technical/organisational measures at least equal to Z-float's (encryption
   in transit TLS ≥1.2, at rest; access controls; logging).
5. Assistance with data subject rights, breach notification (72h to ODPC),
   and DPIAs.
6. Deletion/return of data on termination, with certification.
7. Audit rights (evidence or on-site, reasonable notice).

## 4. DSAR procedure (data subject access requests)

Operational surface (implemented, GAP-ANALYSIS Phase 5):
- **Export** — `GET /api/admin/dsar/export?userId=…` or `?email=…` (platform
  admin session). Returns the personal-data bundle: profile/identity rows,
  roles, sessions metadata, consent, invitations, MFA factors, payment/batch
  records **where the subject is a financial counterpart** (amounts in
  minor-unit strings), and **counts** of immutable login/security/audit events
  and financial records (referenced, not dumped — journals stay intact).
  Errors: unknown user 404, ambiguous email 409, bad input 400.
- **Erasure** — `POST /api/admin/dsar/erasure` with `{ userId?|email?,
  confirm: "ERASE" }`. Scrubs identity to `erased-<id>@erased.invalid`,
  deletes operational stores (sessions, MFA factors/codes, roles,
  notifications, invitations), then **retains under legal obligation**:
  wallet ledger entries, payments, financial recon rows, and immutable audit/
  login/security events (append-only by trigger). The response reports
  `deleted` vs `retained` counts. Self-erasure by the acting admin is
  rejected (403); missing confirmation is 422. Each erasure writes its own
  `dsar.erasure.executed` audit event (accountability).
- Automated integration tests: `packages/audit/test/dsar.integration.test.ts`
  (4/4, incl. deleted-vs-retained assertions).

Procedure for a platform operator:

1. Identity-verify the requester (existing session or ID check) — do not
   over-collect.
2. Log the request via the `data_requests` workflow (type EXPORT/DELETE/
   CORRECTION) — this row is the SLA clock: **respond within 30 days** (DPA
   Sec. 26), extendable once by 30 days with notice.
3. EXPORT: run the export endpoint above; save the JSON bundle into the
   evidence store; serve to the subject.
4. DELETE: run the erasure endpoint above (confirm `"ERASE"`); the reply to
   the subject must state that payments/journals are retained under
   legal-obligation retention (DPA allows retention for legal
   claims/obligations) and are referenced in their bundle.
5. CORRECTION: update + `audit_events` before/after snapshot (accountable
   correction).
6. Reply via the user's registered email; log completion in
   `data_requests.completed_at`; evidence → `data-requests.csv`.

## 5. Breach notification runbook (72h to ODPC)

1. **Detect** (CC7 evidence: security events, login failures, alerts) →
   severity triage: likely harm to data subjects? (financial/PII exposure =
   HIGH).
2. **Contain** (RB-08: rotate `SESSION_SECRET`, revoke API keys, freeze
   wallet/tenant, disconnect provider creds from vault).
3. **Assess**: what categories (§2), how many subjects, technical causes —
   from immutable audit/security logs.
4. **Notify within 72 hours**: ODPC (form per ODPC guidance) + data subjects
   where high risk (DPA Sec. 43); document the notification in
   `security_events` (details jsonb) — that row is the evidence of
   compliance.
5. **Post-incident**: root-cause summary, control changes, evidence run
   (`pnpm evidence`) archived with the incident id.

## 6. Ongoing compliance checks (quarterly)

- [ ] Run `pnpm evidence` and archive the folder (chain-of-custody manifest).
- [ ] Access review: confirm each active user's role matches their function
      (`access-review.csv`), revoke stale accounts.
- [ ] Consent refresh for any purpose where `granted=false` is not honoured.
- [ ] Confirm DSAR backlog is empty (30-day SLA).
- [ ] Re-confirm processor list matches contracts (§3).

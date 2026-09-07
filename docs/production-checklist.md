# Production Checklist — Z-float

Pre-flight checklist for deploying Z-float to a live environment. Complete
every item; a failed item blocks the release. Runbook references: `runbooks.md`.

## 1. Configuration & Secrets

- [ ] `NODE_ENV=production` everywhere (web, worker, seed guard).
- [ ] All secrets in the secret manager: `DATABASE_URL`, `REDIS_URL`
      (Valkey), `S3_*`/object storage, `MPESA_*`, `AIRTIME_API_KEY`,
      `ADMIN_PASSWORD`, session/encryption keys.
- [ ] `SEED_DEMO_DATA` / `DEMO_MODE` are OFF; demo login disabled in prod.
- [ ] Public URLs configured: `MPESA_CALLBACK_BASE_URL` points at the public
      HTTPS webhook endpoint; callbacks reachable from the internet.
- [ ] Provider routes point at production adapters with real credentials
      (sandbox provider disabled / `enabled=false`).
- [ ] `MALWARE_SCANNER_DRIVER=clamav` and `CLAMAV_HOST/PORT` reachable.

## 2. Database & Migrations

- [ ] Postgres 15+ with backups enabled (PITR or nightly + WAL archiving).
- [ ] Migrations applied via `pnpm db:migrate` (idempotent); verified on a
      staging copy first.
- [ ] `pg` extensions used by triggers (deferred constraint, immutability
      trigger) present.
- [ ] DB user has least privilege (no superuser) and SSL enforced.
- [ ] Restore drill performed and documented (runbook RB-xx).

## 3. Workers & Queues

- [ ] Worker runs as a managed service (systemd/k8s), restarts on failure.
- [ ] Valkey/Redis persistent or with AOF for queue durability; queue
      re-enqueue runbooks available.
- [ ] Concurrency tuned (defaults: 9 workers, concurrency 5); monitor queue
      depth and stalled jobs.
- [ ] Idempotency + dedupe verified with the live webhook replay test before
      go-live (never double-execute).

## 4. Web Application

- [ ] `next build` succeeds from clean checkout; static export/SSR verified.
- [ ] Health endpoint responds (`/api/health`); load balancer uses it.
- [ ] Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) verified.
- [ ] Sessions: `Secure` cookie flag, `SameSite=Lax`, HttpOnly — verified in
      prod config.
- [ ] Rate limiting on auth + webhook endpoints active.

## 5. Monitoring & Alerting

- [ ] Log aggregation (structured logs, no PII) + alerts on error rate.
- [ ] Metrics: payment success rate, queue depth, reservation imbalance,
      recon exceptions open, webhook rejection rate.
- [ ] Recon run scheduled (daily) with alerts on UNMATCHED/MISMATCH.
- [ ] `monitorStuckPayments` runs on schedule; PROVIDER_PENDING older than
      threshold alerts.

## 6. Security & Compliance

- [ ] Security checklist (`security-checklist.md`) fully checked.
- [ ] `pnpm audit` clean or documented exceptions in KNOWN_LIMITATIONS.md.
- [ ] Admin console access restricted by IP/SSO; MFA enforced for admins.
- [ ] Data retention + consent documented; ODPC-aligned privacy practices in
      place (see KNOWN_LIMITATIONS.md for scope honesty).
- [ ] No regulatory claims made without a licensed partner; marketing copy
      reviewed.

## 7. Release Verification (final gate)

- [ ] `pnpm -r typecheck` → 0 errors
- [ ] `pnpm lint` → 0 errors
- [ ] `pnpm -r build` → all packages build
- [ ] `pnpm -r test` → all suites pass (unit + integration)
- [ ] E2E (Playwright) passes against the deployed build
- [ ] Demo seed works in staging; admin pricing change takes effect without
      code changes (fee snapshot on next payment)
- [ ] Webhook replay test passes live; reconciliation detects a seeded
      mismatch

- [ ] Set `COOKIE_SECURE=true` in production (the demo build does NOT force the
      Secure cookie flag, so the preview works over plain http; production must
      explicitly enable it).
- [ ] Set `REPORT_STORAGE_DIR` to a shared, backed-up absolute path (or S3) used
      by both the web app and the worker for CSV report exports.

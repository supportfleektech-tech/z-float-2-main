# Runbooks

Operational procedures for the Z-float demo platform. Follow in order; log timestamps and outcomes.

## RB-01 Local reset & seed

**When:** fresh start, corrupted demo data, or after schema changes.

> ⚠ Stop the web app and worker first — `db:reset` DROPs the database and
> their Postgres pools are killed (the processes exit).

```bash
# 1. Stop web + worker (Ctrl-C / stop the services)

# 2. Reset (drops DB, recreates, migrates AND seeds in one command)
#    — dev env must be exported (SEED_DEMO_DATA=true, NODE_ENV != production)
source /tmp/zf-env.sh
pnpm db:reset

# or manually:
#   drop/create the DB, then:
pnpm --filter @zfloat/database db:migrate
pnpm --filter @zfloat/database db:seed

# 3. Restart web + worker
```

Verify: `✅ Seed complete!` and login `demo@zfloat.app / Demo@12345` works.

## RB-02 Run the full stack locally

```bash
# Terminal 1 — web app (Next.js on :3000)
pnpm --filter @zfloat/web dev

# Terminal 2 — worker (queue workers + outbox poller + cron)
pnpm --filter @zfloat/worker dev
```

Prerequisites: PostgreSQL + Valkey/Redis running (see docker-compose.yml).

## RB-02b Sandbox demo stack — production build (the recipe the full gate uses)

Everything runs against `next start` (prod server) with the demo credentials in
`/home/user/zfloat/.env` (demo@zfloat.app / admin@zfloat.app) — the E2E suite,
soak profiles and live curl checks all use this exact topology:

```bash
# 0. Services (postgres, redis) up. 1. Prod-class env — canonical copy lives in
#    the repo so it survives sandbox wipes:
#    scripts/tools/env-sandbox.sh  →  cp it to /tmp/zf-build-env.sh if needed
. scripts/tools/env-sandbox.sh
#    (sets NODE_ENV=production, DEMO_MODE=true, SEED_DEMO_DATA=false,
#     MALWARE_SCANNER_DRIVER=clamav, AUTH_LOGIN_RATE_MAX=1000)

# 2. Build once (packages → services → web):  pnpm build   (must NOT run while
#    a dev server is live — see RB-10)
pnpm --filter @zfloat/worker build && pnpm --filter @zfloat/outbox-relay build

# 3. Run (three shells):
node services/worker/dist/index.js            # queue workers + outbox poller + cron
node services/outbox-relay/dist/index.js      # standalone outbox relay
node scripts/tools/clamd-stub.mjs             # malware-scan stub on 127.0.0.1:3310
pnpm --filter @zfloat/web start               # next start on :3000

# 4. Nightly backup cron (fresh sandboxes need the cron package installed):
#    crontab line: 0 2 * * * /home/user/zfloat/scripts/backup.sh >> .../backup.log 2>&1

# 5. Playwright full suite OWNS :3000 (kills/restarts its own server):
pnpm test:e2e        # 34/34 passed (baseline after the flake-elimination close-out;
#                       see KNOWN_LIMITATIONS #23 + data/e2e/final-suite-*.log)
#    after a suite run, restart the prod web if the live preview is needed again.
```

Live evidence produced by this recipe: `data/openapi-verify-*.json`,
`data/soak/soak-*.json`, `data/backups/restore-drill-*.log`,
`data/screenshots/*.png`, plus the close-out verification set:
`data/admin-api-verify-*.json`, `data/compliance/dsar-wire-*.json`,
`data/chaos/{worker-crash,redis-outage,pg-outage}-*.json`,
`data/webhooks/fanout-*.json`, `data/performance/explain-*.log`,
`data/pitr/pitr-drill-summary.json`, `data/e2e/final-suite-*.log` (newest: the post-environment-recycle from-scratch run
`final-suite-20260904-020234-retries0-freshenv.log`).



## RB-03 Reconcile the ledger manually

**When:** a recon exception is raised or after a provider incident.

```bash
# Trigger a reconciliation run (marks MATCHED/PARTIAL/UNMATCHED, raises exceptions)
curl -X POST http://localhost:3000/api/reconciliation/run \
  -H "Cookie: zf_session=<session>"   # or use the admin UI button
```

Then inspect `recon_exceptions` (UI: portal/reconciliation, admin/reconciliation).

## RB-04 Monitor stuck payments

The worker's `payments.monitor` job (60s) flags payments stuck in
PROCESSING/PROVIDER_PENDING for >15 min as `UNKNOWN`, then re-checks provider
status. If a payment remains UNKNOWN > 30 min, escalate (provider outage).

```sql
-- find stuck payments
SELECT payment_number, status, updated_at, failure_reason
FROM payments
WHERE status IN ('PROCESSING','PROVIDER_PENDING','UNKNOWN')
  AND updated_at < now() - interval '15 minutes';
```

## RB-05 Restore drill (backup / restore)

1. Backup:
   ```bash
   PGPASSWORD=zfloat_dev_password pg_dump -h 127.0.0.1 -U zfloat -d zfloat -Fc > backup_$(date +%F).dump
   ```
2. Restore to a new DB:
   ```bash
   PGPASSWORD=zfloat_dev_password createdb -h 127.0.0.1 -U zfloat zfloat_restore
   PGPASSWORD=zfloat_dev_password pg_restore -h 127.0.0.1 -U zfloat -d zfloat_restore backup_$(date +%F).dump
   ```
3. Verify: run `RB-04` stuck-payment query and check payment counts; point
   `DATABASE_URL` at the restored DB and smoke-test login + a sandbox payment.

> Practice the drill at least quarterly. Record restore time and issues.

Automated nightly backup (sandbox + prod posture): `scripts/backup.sh`
(run via cron `0 2 * * *`) does `pg_dump -Fc`, writes a `.sha256`, keeps 7
days (`KEEP_DAYS`), logs to `data/backups/backup.log`. Rehearse the restore
with `scripts/restore-drill.sh` (restores the newest dump to a scratch DB,
verifies 12 core tables row-for-row, drops the scratch DB).

**WAL archiving (beyond nightly dumps, for real prod):** enable
`archive_mode = on`, `archive_command` shipping to object storage (or
`pg_basebackup` + WAL segments for PITR). Nightly dumps give point-of-run
restores; WAL archiving gives point-in-time recovery to seconds before a
failure. Retention of archived WAL should match the longest legal/ops
retention you commit to (see compliance pack).

## RB-06 Admin pricing change (no code change)

1. Login as platform admin → **Pricing & fees**.
2. Edit a rule → Save & version.
3. Confirmed by: new `fee_versions` row, `audit_events` entry
   (`pricing.rule.updated`), and **live** effect on the next fee preview /
   payment (rules are read from DB at request time).
4. Historical payments keep their original fee snapshots (`fee_calculations`).

## RB-07 Webhook replay simulation

```bash
# Send the same payload twice; the second is acked as duplicate (200) without
# double-execution.
curl -s -X POST http://localhost:3000/api/webhooks/mpesa \
  -H "content-type: application/json" \
  -d '{"eventId":"rb-replay-1","type":"payment.completed","providerReference":"RB-REF-1","amountMinor":"1000","status":"SUCCESS"}'
# run twice — second response: {"status":"duplicate"}
```

## RB-08 Security incident (credential leak)

1. Revoke sessions: delete from `sessions` for affected users.
2. Rotate `ENCRYPTION_KEY` + provider credentials; redeploy.
3. Audit: query `security_events` + `login_events` for the window.
4. Review outbox for leaked PII; follow the no-PII-in-logs rule.

## RB-09 Queue backlog check

```bash
# count jobs in the payments.execution queue
redis-cli llen bull:payments.execution:wait
redis-cli llen bull:payments.execution:delayed
```
If wait > 5000, scale worker concurrency (`WORKER_CONCURRENCY`) or add workers.


## RB-09b Prometheus scrape config (admin metrics endpoint)

`GET /api/admin/metrics` — platform-admin session, Prometheus text format
(0.0.4). Scrape with bearer auth using a platform admin's session cookie or
front it with an authenticated reverse proxy; do NOT expose it publicly.

Metric names (all `zfloat_*`):
- `zfloat_queue_jobs{queue,state}` — BullMQ waiting/active/delayed/failed per
  queue (gauges; polled every ~10s server-side).
- `zfloat_outbox_unpublished`, `zfloat_outbox_oldest_unpublished_seconds` —
  outbox lag.
- `zfloat_worker_heartbeat_age_seconds` — seconds since the worker wrote
  `zfloat:worker:heartbeat` (it writes every 30s); -1 until the first beat.
- `zfloat_postgres_up`, `zfloat_redis_up` — connectivity probes.
- `zfloat_payments_24h_total{outcome}`, `zfloat_webhook_deliveries_24h_total{outcome}`
  — rolling 24h counts.
- `zfloat_ledger_health_last_run_age_seconds` — age of the last ledger-health run
  (Redis key `zfloat:ledger:last`).
- `zfloat_info` — build/runtime info label.

Example scrape job:

```yaml
scrape_configs:
  - job_name: zfloat
    metrics_path: /api/admin/metrics
    bearer_token_file: /etc/zfloat/admin-scrape.token
    static_configs: [{ targets: ["zfloat-app:3000"] }]
    scrape_interval: 30s
```

Alert hooks already inside the app: /admin/health rule evaluation + Phase-4
out-of-band ops notifications (see `apps/web/lib/ops-alerts.ts`).

## RB-10 Production build (env requirements)

`next build` must run with a **production-mode** environment. A dev env
(`NODE_ENV=development`, `DEMO_MODE=true`, zero `ENCRYPTION_KEY`) breaks
prerendering for every page (dev/prod runtime mixing: `<Html> should not be
imported outside of pages/_document`, `useContext` null).

```bash
# Local build helper (production env, real keys) — canonical env file in-repo:
. scripts/tools/env-sandbox.sh && pnpm build     # (apps/web; /tmp copy optional)

# CI: set NODE_ENV=production, SESSION_SECRET (non dev-only),
#     ENCRYPTION_KEY (non-zero hex), DEMO_MODE=false, SEED_DEMO_DATA=false,
#     MALWARE_SCANNER_DRIVER=clamav (see .github/workflows/ci.yml)
# (DEMO_MODE=true is only for the deliberate demo-walkthrough deployment
# class — an explicit opt-in the config guard allows under production;
# SEED_DEMO_DATA=true is always refused there. Seed the demo DB once, offline.)
```

> ⚠ Never run `next build` while a `next dev` server is running — both
> processes write `apps/web/.next` and the build races the dev server's
> hot-reloader, producing chunk corruption (`Cannot find module './NNN.js'`,
> 500s on every page). Stop the dev server first; if a build did race,
> `rm -rf apps/web/.next` and rebuild clean.

Note: `pnpm ci` is a pnpm built-in — the local full-gate script is
`pnpm run ci:local` (lint → typecheck → unit → integration → build).

## RB-10b Report exports (CSV)

`POST /api/reports` creates a report row and enqueues `reports.generate`; the
worker writes the tenant-scoped CSV to `REPORT_STORAGE_DIR` (set it to the SAME
absolute path for the web app and the worker — a relative default breaks
downloads when the two processes have different working directories).
Download: `GET /api/reports/{id}/export` (tenant-scoped; 404 for other tenants).

## RB-11 E2E suite (production server)

E2E runs against `next start` for determinism (no dev-compile flakes). The
production config guard requires the build env; demo login still works because
the seed wrote the demo users into the DB.

```bash
# 1. Seed the demo DB (dev env) — RB-01
# 2. Build the web app — RB-10
# 3. Run the suite with the build env exported (Playwright starts next start):
cd apps/web && source /tmp/zf-build-env.sh && pnpm test:e2e
```

Expected: **34/34 passed** (current baseline — see KNOWN_LIMITATIONS #23 for the
flake-elimination close-out and `data/e2e/final-suite-*.log` for the run evidence).
The suite warms routes first (e2e/global-setup.ts); after a suite run, restart the
prod web (`pnpm start`) if the live demo is needed again (the suite owns :3000).

## RB-12 Outbox relay as a separate deployment

The outbox poller (outbox_events → execution queue / notifications / webhooks)
is a shared loop in `packages/payments-core/src/outbox-relay.ts`:

- embedded in the worker (default — keeps the historical single-process model), and
- deployable standalone as `services/outbox-relay` for production scale-out.

```bash
# Dev / local: relay alongside the worker (either one alone is also fine)
pnpm dev:relay          # tsx, hot reload
pnpm start:relay        # prod build: node services/outbox-relay/dist/index.js
```

- Concurrency: every poll tick takes a Postgres advisory transaction lock
  (`pg_try_advisory_xact_lock`, key 723993001). Worker + N relay instances can
  run together; exactly one wins each tick, so events are never
  double-dispatched (verified live + integration-tested). The lease commits
  atomically with the markPublished updates and auto-releases on crash.
- Cadence: `OUTBOX_RELAY_INTERVAL_MS` (default 5000).
- Delivery is at-least-once: failed handlers bump `attempts` (cap 10 in
  `pullUnpublished`) and the event is retried on later ticks.
- Runbook RB-02 (worker) already exercises the embedded path; E2E covers the
  full outbox → webhook/notification flows.

## RB-13 Multi-region Postgres & read replicas (topology notes)

Current state: single primary Postgres; the app always reads+writes the
primary, and all transaction/outbox invariants depend on that. When moving to
replicas, keep these rules:

1. Writes and transactional reads stay on the PRIMARY (payments, wallets,
   ledger, outbox_events, idempotency_keys — anything with FK/constraint
   guarantees). Replicas serve only analytics/read-only surfaces (reports,
   audit browsing, observability).
2. Never read replicas for: idempotency lookups, outbox dispatch, approval
   expiry, reconciliation, monitor/recovery sweeps — all are
   read-then-act and must see committed truth.
3. Outbox poller instances are deployment units (RB-12), not per-region
   shards: run them in the region that owns the primary; their advisory-lock
   arbitration already prevents cross-region double dispatch, but latency to a
   remote primary makes ticks jittery — keep the relay close to the DB.
4. Failover: promote a replica (e.g. Patroni/cloud managed), point
   DATABASE_URL at the new primary, restart worker + relays. BullMQ/Redis
   should sit in the same region as the primary; a full region failover also
   requires Redis + object storage re-pointing (see RB-05 restore drill).
5. Healthy-backlog monitors (RB-09) and the ledger health job run on the
   primary to avoid replica lag false positives.

## RB-14 Platform secrets vault (KMS-backed)

Batch-C2: platform secrets move out of plain env vars into encrypted envelope
files keyed by a real KMS key in production, with an AES-256-GCM local driver
for dev/staging. Resolution order per secret: explicit env var > envelope
file (`${SECRETS_DIR}/${NAME}.json`) > built-in dev default / hard fail.

Drivers (`SECRETS_DRIVER`): `none` (env only — default), `local`
(`SECRETS_LOCAL_KEY`, 64-hex), `kms` (`SECRETS_KMS_KEY_ID` + AWS creds/role;
per-secret 256-bit data key wrapped by KMS — real envelope encryption).
`SECRETS_DIR` defaults to `./data/secrets`.

```bash
# dev: generate a local key, put SECRETS_DRIVER=local + SECRETS_LOCAL_KEY in .env
pnpm secrets gen-key
# seal/rotate a secret (writes SECRETS_DIR/<NAME>.json, mode 600)
pnpm secrets set MPESA_CONSUMER_SECRET s3cr3t     # or: --driver kms
pnpm secrets list                                 # source trace per secret
pnpm secrets unset MPESA_CONSUMER_SECRET
```

Wiring: applied once at process start by `applySecretsToEnv()` — worker
(`services/worker`), standalone relay, and the web app
(`apps/web/instrumentation.ts`) — before any config parse/adapter build. Env
values always win, so local dev keeps working with zero setup. Startup FAILS
loudly if a vault file can't be decrypted (wrong key/tamper) or KMS unwrap
fails — never run production on silently-missing secrets.

Production posture:
- `SECRETS_DRIVER=kms`, KMS key in a tightly-scoped alias (e.g.
  `alias/zfloat-secrets`); app role only needs `kms:Decrypt`.
- Envelope files ship on the deployment volume / K8s secret (never commit the
  `local`-wrapped ones). Rotation = `secrets set` again; each write creates a
  fresh data key + IV (local driver) or fresh KMS wrap (kms driver). No
  in-place mutation, so files are safe to ship via immutable artifacts.
- Rotating the KMS key itself only affects NEW envelopes; old envelopes keep
  decrypting while the old key is still enabled (KMS handles re-wrap on
  `Decrypt`), so rotation is zero-downtime.
- `ENCRYPTION_KEY` / `SESSION_SECRET` may also live in the vault; the local
  driver refuses to start if an envelope exists but `SECRETS_LOCAL_KEY` is
  absent (mis-configuration guard).

## RB-15 Wallet reservation ledger (C-3)

Every movement of wallet money — and every DENIED attempt — is appended to
`wallet_ledger_entries` (per wallet):

- Types: FUND (+available), RESERVE (-available +reserved), RELEASE
  (+available -reserved), APPLY (-reserved), RESERVE_DENIED (deltas 0 —
  audited double-spend attempt).
- Rows carry signed deltas + balance-after columns; a DB trigger rejects any
  row whose balance-after doesn't match the wallet state, and blocks
  UPDATE/DELETE entirely (append-only). The ledger replays to prove balances.
- Reads: `listWalletLedgerEntries(db, {walletId, limit?, entryType?})`,
  `countDeniedReservations(db, walletId)` (both from `@zfloat/ledger`).

```sql
-- double-spend audit: recent denied attempts per wallet
SELECT wallet_id, amount_minor, created_at, note
FROM wallet_ledger_entries
WHERE entry_type = 'RESERVE_DENIED'
ORDER BY created_at DESC LIMIT 20;

-- replay proof: ledger deltas must reproduce the wallet's current state
SELECT wallet_id,
       sum(delta_available_minor) AS ledger_available,
       sum(delta_reserved_minor)  AS ledger_reserved
FROM wallet_ledger_entries GROUP BY wallet_id;
```

Operational notes:
- A denial writes its row in a separate transaction so it survives the
  InsufficientFundsError raised to the caller (never roll back the audit).
- The ledger covers new code paths; rows seeded before C-3 have no entries
  (the table starts empty for pre-existing wallets — expected, see seed).
- RESERVE_DENIED is an audit, not an error signal: the payment is failed by
  the business layer exactly as before (insufficient-balance path).

## RB-16 Compliance evidence collection (SOC2/ODPC)

`pnpm evidence` collects control evidence from the live DB into
`data/compliance/<timestamp>/` (audit/login/security events, access review,
consent/DSAR/KYC records, ops health, migration ledger, redacted env
snapshot, dependency audit) with a SHA-256 MANIFEST for chain of custody.
See `docs/compliance/README.md` + controls map `soc2-controls-map.md`.

## RB-17 Penetration test (authorized scope)

Scope, prep checklist, OWASP Top 10 → product-guard mapping, financial
double-spend tests, reporting template and remediation SLA:
`docs/compliance/pen-test-runbook.md`. Every finding must reference the
immutable audit/security event that captured it.

## RB-18 ODPC data protection (Kenya DPA 2019)

Records of processing, data inventory → system mapping, processor (DPA)
terms, DSAR 30-day procedure, and 72-hour breach notification:
`docs/compliance/odpc-dpa-pack.md`. Run `pnpm evidence` before/after any
incident so `security_events` rows document the response.

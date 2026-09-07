# Z-float — Operator Guide (`guide.md`)

End-to-end: what this is, how to set it up locally, how to run and test
everything, how to insert production credentials, how to certify each Batch-D
provider, how to deploy, and how to decide you're ready to go live.

Companion files:
- `credentials.md` — the register of every credential to obtain/insert.
- `docs/runbooks.md` — day-2 operations (RB-01…RB-18).
- `docs/production-checklist.md` — pre-flight release checklist.
- `docs/security-checklist.md` — security release/incident checklist.
- `docs/compliance/` — SOC2 evidence, ODPC DPA pack, pen-test runbook.
- `docs/KNOWN_LIMITATIONS.md` — honest scope notes.

---

## 1. What you're running

```
┌───────────────────────────── apps/web (Next.js 14) ─────────────────────────────┐
│ marketing site · business portal (/portal) · platform admin (/admin) ·          │
│ REST APIs · public webhook gateway /api/webhooks/{mpesa,bank}                   │
└──────┬───────────────────────────────┬──────────────────────────────────────────┘
       │ enqueue (BullMQ)              │ outbox_events rows
       ▼                               ▼
┌──────────────┐  ┌───────────────────────────────────────────────┐
│ Redis/Valkey │  │ services/worker (10 queues + cron)            │
│ queues + rl  │  │   + embedded outbox poller  (5s)              │
└──────────────┘  │ services/outbox-relay  (optional standalone)  │
                  └───────────────────────────────────────────────┘
       PostgreSQL 16 — wallets/ledger (immutable journals + reservation
       ledger), payments, approvals, outbox, audit (append-only), KYC/AML
```

Money never touches floats in code paths you can't audit: double-entry
journals (DB trigger-enforced balance), atomic per-wallet reservations,
replay-safe webhooks, reconciliation engine.

## 2. Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥ 20.11 | runtime |
| pnpm | 9.x (`corepack enable`) | workspace |
| PostgreSQL | 15/16/17 | primary store |
| Redis or Valkey | 7/8 | queues + rate limits + heartbeat |
| (optional) ClamAV clamd | any recent | KYC file scanning (`clamav` driver) |
| (optional) Docker | 24+ | compose stack / images |

## 3. Local setup (first run)

```bash
# 1. Copy the env template and fill in local values
cp .env.example .env            # DATABASE_URL, REDIS_URL to your local PG/Redis

# 2. Install + build workspace packages
pnpm install
pnpm -r --workspace-concurrency=1 --filter './packages/*' --filter './services/*' build

# 3. Database: create role/db (Postgres), then
pnpm db:reset                   # drop → migrate (drizzle + custom SQL triggers) → seed demo
# …or step by step: pnpm db:migrate  then  pnpm --filter @zfloat/database db:seed

# 4. Run the three processes (three terminals)
pnpm dev                        # web → http://localhost:3000
pnpm dev:worker                 # queues + cron + embedded outbox poller
pnpm dev:relay                  # OPTIONAL standalone outbox relay (scale-out test)
```

Demo logins (seed only): `demo@zfloat.app / Demo@12345` (business owner),
`admin@zfloat.app / Demo@12345` (platform admin).

> Local quirks worth knowing
> - `pnpm db:reset` drops the DB — stop web/worker first (RB-01).
> - `next build` needs a production-mode env (RB-10): `NODE_ENV=production`,
>   `DEMO_MODE=false`, `SEED_DEMO_DATA=false`, non-zero keys.
> - Integration suites truncate the **test** DB and must run sequentially —
>   always use `pnpm test:unit` / `pnpm test:integration`, never raw `-r test`.

## 4. Verifying the build (the gate)

```bash
pnpm typecheck                  # 0 errors expected
pnpm test:unit                  # unit suites (needs DATABASE_URL_TEST migrated)
pnpm test:integration           # real-PG suites (ledger, payments, kyc, approvals)
pnpm --filter @zfloat/web exec playwright test   # full E2E on the prod build (25 specs)
pnpm evidence                   # compliance evidence snapshot (docs/compliance)
```

CI mirror: `.github/workflows/ci.yml` runs lint → typecheck → unit →
integration → web build. `pnpm ci:local` reproduces it locally.

## 5. Credentials — the insertion flow

1. Open `credentials.md` and work top to bottom; obtain every value from the
   listed sources.
2. Insert:
   - **Dev/staging:** add `NAME=value` lines to `.env`.
   - **Production:** enable the vault —
     `SECRETS_DRIVER=kms`, `SECRETS_KMS_KEY_ID=<key>` (see credentials.md §4),
     then `pnpm secrets set NAME value --driver kms` per secret
     (writes `SECRETS_DIR/<NAME>.json`, mode 600). Env vars always win over
     the vault, so don't also export the same names.
3. Re-run the readiness table and close every gap:

```bash
pnpm check:creds        # ✓ ok / ◈ vault / ⚠ attention / ✗ missing
pnpm secrets list       # per-secret source trace (env | envelope:kms | unset)
```

Keep the local `local` driver (`SECRETS_DRIVER=local` + `SECRETS_LOCAL_KEY`
from `pnpm secrets gen-key`) for staging; **never** ship `local` envelopes or
the key to production.

## 6. Batch-D certification procedure (do in this order)

Each step says what credential it consumes and what "pass" looks like.
Nothing here moves real money until you decide to flip `PROVIDER_DEFAULT`
away from `local-sandbox`.

### 6.1 M-Pesa Daraja — sandbox first, then live
1. Insert §2 credentials (`MPESA_ENVIRONMENT=sandbox` to start).
2. Run the adapter contract suite (proves the wire protocol):
   ```bash
   pnpm --filter @zfloat/providers test    # 10/10 incl. OAuth, B2C, STK, status, reversal
   ```
3. Sandbox smoke through the running stack: create a payment with
   `PROVIDER_DEFAULT` unchanged, then exercise the Daraja flow via the
   provider monitor/jobs with `MPESA_API_BASE_URL` pointing at the emulator;
   watch `payments` → `PROVIDER_PENDING → SUCCESS` with a real-looking
   `provider_reference`, then a reversal.
4. Live certification (requires Safaricom go-live pack): set
   `MPESA_ENVIRONMENT=production`, real shortcode/passkey/initiator,
   `MPESA_CALLBACK_BASE_URL=https://<your-domain>` and register the callback
   URL in the Daraja app. Make a **small** B2C test transaction to a known
   phone; assert: payment row SUCCESS, webhook received once (dedupe a replay),
   journal posted, wallet/ledger balances consistent (`pnpm evidence` +
   runbook RB-03/RB-15 SQL).
5. Update `docs/KNOWN_LIMITATIONS.md` #1 and flip the provider default.

### 6.2 PesaLink / bank rails
1. Insert §3 credentials from your bank partner.
2. Contract-verify `bank-psp` (same adapter suite) with the partner's docs;
   confirm the webhook signature header your bank sends maps to
   `x-webhook-signature` + `BANK_API_SECRET` (adjust in
   `apps/web/app/api/webhooks/bank/route.ts` if the partner uses a different
   header scheme).
3. Sandbox test payment → confirm PENDING → SUCCESS + reversal + recon
   import on the partner statement.

### 6.3 Real S3 (replace MinIO verification)
1. Insert §4.1–4.5; set `STORAGE_DRIVER=s3`.
2. Re-run the storage contract suite against real S3:
   `pnpm --filter @zfloat/storage test` (8/8 against the S3 wire protocol).
3. Produce a scheduled report → confirm `payload_ref=s3://reports/<id>.csv`
   in the DB and the object in the bucket; run the retention sweep and
   confirm expiry; upload a KYC doc → object appears under `kyc/<tenant>/…`.
4. Bucket hardening (credentials.md §4): versioning, SSE-KMS, lifecycle.

### 6.4 KMS vault live proof
1. Create the KMS key, grant the app role `kms:Decrypt`.
2. `pnpm secrets set SESSION_SECRET <value> --driver kms`, restart worker +
   web; confirm boot applies it (`pnpm secrets list` → `envelope:kms`) and
   sessions still work. Rotate one secret and confirm zero-downtime re-wrap.

### 6.5 Email (SMTP/SES) + SMS (Africa's Talking)
1. Insert §5/§6; `EMAIL_DRIVER=smtp`, `SMS_DRIVER=http`.
2. Message Center → test EMAIL and test SMS (credentials.md §5.6/§6.4);
   row goes QUEUED → SENT with driver recorded.
3. Trigger a real invite (invite a teammate) and confirm the email arrives
   and the token is NOT in the API response (production path).
4. Report-schedule email receipt if enabled.

### 6.6 Licensed watchlist feed + identity verification
1. Choose vendors (credentials.md §7); add the ingestion job into the worker
   (`aml_watchlists` is the load target; `@zfloat/kyc` screens against it)
   and wire `VERIFY_*` into `verification_documents` review.
2. Confirm a watchlist-hit payment still risk-flags and forces approval
   (existing E2E `compliance.spec.ts` proves the flow with demo data).

### 6.7 Real ClamAV
Run clamd, set `MALWARE_SCANNER_DRIVER=clamav`, upload an EICAR test file →
status INFECTED; a clean PDF → CLEAN (E2E `compliance.spec.ts` covers the
UI flow on the mock driver).

## 7. Deploy

### 7.1 Environment matrix (production)

| Group | Values |
|---|---|
| Mode | `NODE_ENV=production`, `DEMO_MODE=false`, `SEED_DEMO_DATA=false`, `COOKIE_SECURE=true` |
| Core | `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY` (all via vault/kms) |
| Vault | `SECRETS_DRIVER=kms`, `SECRETS_KMS_KEY_ID`, `SECRETS_DIR` (persistent volume) |
| Storage | `STORAGE_DRIVER=s3`, `S3_BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY` |
| Providers | §2–§6 of credentials.md, incl. `MPESA_CALLBACK_BASE_URL=https://<domain>` |
| Security | `MALWARE_SCANNER_DRIVER=clamav`, `CLAMAV_HOST/PORT` |
| URL | `APP_URL`, `API_URL` (public HTTPS origins) |

### 7.2 Build & run (Docker)

```bash
# Production build of web + worker + relay images
docker compose build web worker relay

# One-shot migrations on the real DB (idempotent)
docker compose run --rm migrate        # (set DATABASE_URL/SEED_DEMO_DATA=false in prod)

docker compose up -d postgres valkey web worker
# scale-out relay (optional; safe alongside the worker thanks to lease arbitration):
docker compose up -d relay
```

Non-Docker: `pnpm -r --filter './packages/*' --filter './services/*' build`,
`pnpm --filter @zfloat/web build` (RB-10 env), then run
`apps/web` (`next start`), `services/worker/dist/index.js`,
`services/outbox-relay/dist/index.js` under a process manager.

Order at first boot: **migrate → web/worker up → health check → flip
provider default** (keep `local-sandbox` until certification §6 is done).

### 7.3 Post-deploy verification (the "are we live" minute)
```bash
pnpm check:creds                  # 0 missing / 0 attention
curl -s https://<domain>/api/health | jq    # all checks OK, worker heartbeat fresh
pnpm evidence                     # archive baseline artifacts
# E2E against the deployed build (staging, same image): 28 passed + 1 known-flaky (retry-pass)
```

## 8. Operating

- **Day-2 runbooks:** `docs/runbooks.md` — RB-02 stack, RB-03 ledger
  reconcile, RB-04 stuck payments, RB-05 backup/restore drill, RB-08
  credential leak, RB-09 queue backlog, RB-12 relay scale-out, RB-13
  multi-region notes, RB-14 secrets vault, RB-15 wallet ledger,
  RB-16/17/18 compliance/pen-test/ODPC.
- **Monitoring:** `/admin/health` (checks, metrics, alert rules, 30s
  auto-refresh); worker heartbeat; `pnpm evidence` snapshots on a schedule.
- **Backups:** nightly Postgres dump or PITR; object storage versioning;
  restore drill quarterly (RB-05).
- **Incidents:** `docs/security-checklist.md` (top to bottom) + RB-08;
  breach notification timeline in `docs/compliance/odpc-dpa-pack.md` §5.

### 8.1 Maker-checker controls (what needs two people)

Z-float enforces maker–checker on every operation that moves money or grants
power. The **maker** initiates; a **second, distinct user** (never the maker —
the engine rejects self-approval, including via delegation) reviews and
approves or rejects in the **Approval center** (`/portal/approvals`); the
action only executes on approval, and every action is in the audit trail.

| Operation | Maker step | Checker step |
|---|---|---|
| Payment above policy threshold | create → `PENDING_APPROVAL` (funds reserved, not sent) | approve → queued → executed |
| Batch / bulk payout | create + submit → `PENDING_APPROVAL` | approve → rows materialized |
| Add payee to the payee book | register → payee `PENDING` | approve → payee `ACTIVE` (payable) |
| Payment reversal | request on a successful payment → nothing moves yet | approve → provider reversal + compensating journal → `REVERSED` |
| Invite into a privileged role (approve/reverse/manage powers) | invite → `PENDING`; invitee cannot register | approve → invitee can register into the role |

- **Policy source:** production submits resolve the tenant's **ACTIVE
  published approval policy** (admin console → Approval policies). A tenant
  with no published policy cannot move money at all (fail closed —
  `APPROVAL_POLICY_REQUIRED`), so publish one before go-live. Demo mode runs
  a built-in policy: payments **at/above KES 10,000** need one APPROVER;
  below that a single maker proceeds (demo walkthrough unchanged).
- **Roles:** checkers must hold approval power (`payment.approve` /
  `batch.approve` — APPROVER, FINANCE_MANAGER, OWNER). Requests resolve
  through the same sequential/parallel/ANY engine; policy rules and amounts
  are snapshotted immutably per request.
- **Fail-closed defaults:** payee registration, reversal requests and
  privileged role invites always require an independent approver — there is
  no per-tenant off switch (deliberate; see KNOWN_LIMITATIONS #14b for the
  one remaining single-actor surface: platform-admin config changes).

## 9. Troubleshooting (quick hits)

| Symptom | Cause / fix |
|---|---|
| `[config] Production environment is missing critical variables` | Prod env lacks DATABASE_URL/REDIS_URL/SESSION_SECRET/ENCRYPTION_KEY or they're dev defaults |
| `DEMO_MODE and SEED_DEMO_DATA must be false in production/staging` | Set both false (RB-10) |
| `next build` prerender failures (`<Html> should not be imported`) | Build ran with NODE_ENV=development in env — use the RB-10 build env |
| Webhooks not arriving | `MPESA_CALLBACK_BASE_URL` not public HTTPS; callback URL not registered in Daraja app |
| Payments stuck PROVIDER_PENDING | Worker down (heartbeat alert) or provider timeout — RB-04 |
| Submit returns `APPROVAL_POLICY_REQUIRED` | Tenant has no ACTIVE published approval policy — publish one in the admin Approval policies console (money movement fails closed until then) |
| Payee stays "Pending approval" | An APPROVER/FINANCE_MANAGER/OWNER must activate it in the Approval center — this is by design (maker–checker) |
| Reversal / role invite stuck | Check the Approval center — the request needs an independent checker's sign-off before it executes |
| `ENCRYPTION_KEY must be 64 hex` | `openssl rand -hex 32`; never the all-zero default in prod |
| Vault refuses to start (`SECRETS_LOCAL_KEY is not set`) | `local` envelope exists but driver key missing (RB-14) |
| E2E/CI DB races | Suites truncate the shared test DB — sequential only (KNOWN_LIMITATIONS #18) |
| Reports 404 on export | `REPORT_STORAGE_DIR` must be shared/backed-up and identical for web + worker |

## 10. Go-live checklist (final)

- [ ] `docs/production-checklist.md` every box ticked.
- [ ] `docs/security-checklist.md` every box ticked.
- [ ] `pnpm check:creds` → 0 missing, 0 attention (optional telemetry aside).
- [ ] Full gate green on the deploy image: typecheck / unit / integration /
      E2E (25/25) / prod build.
- [ ] Batch-D certifications done (§6): Daraja live smoke, bank/PesaLink
      sandbox, real-S3 report round-trip, KMS vault live, SMTP+SMS test
      sends, watchlist/verify vendors chosen and wired.
- [ ] Restore drill exercised (RB-05); monitoring dashboards/alerts live;
      `pnpm evidence` baseline archived.
- [ ] Legal/compliance: ODPC DPA pack filled with the real entity; no
      unlicensed claims (KNOWN_LIMITATIONS #13); demo data off.

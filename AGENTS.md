# Z-float — Agent Instructions

## Quick Reference

**Monorepo:** pnpm workspace (apps/web, services/worker, services/outbox-relay, 17 packages under packages/)
**Stack:** Next.js 14 App Router + TypeScript + Tailwind, PostgreSQL 16 + Drizzle ORM, Valkey/Redis + BullMQ

## Essential Commands

```bash
# Install + build (run once)
pnpm install
pnpm -r build

# Database (local dev)
pnpm db:migrate        # applies drizzle + custom SQL migrations
pnpm db:seed           # seeds demo tenant, users, pricing, approvals, 50 transactions
pnpm db:reset          # drop → migrate → seed (DANGER: drops DB)

# Run (three terminals)
pnpm dev               # web on :3000
pnpm dev:worker        # 10 queue workers + cron + embedded outbox poller
pnpm dev:relay         # optional: standalone outbox relay (lease-arbitrated scale-out)

# Verification gate (CI mirrors this)
pnpm ci:local          # lint → typecheck → test:unit → test:integration → web build
```

## Test Strategy

| Suite | Command | DB Required | Notes |
|-------|---------|-------------|-------|
| Unit | `pnpm test:unit` | `DATABASE_URL_TEST` | 14 packages, sequential, 1-2 min |
| Integration | `pnpm test:integration` | `DATABASE_URL_TEST` | 5 packages, sequential, truncates test DB |
| E2E | `pnpm test:e2e` | running web + seeded DB | Playwright, 25 specs, ~3 min |

**Never run `pnpm -r test`** — integration suites share `zfloat_test` DB and must run sequentially (`--workspace-concurrency=1`).

## Environment Gotchas

- **`.env` location matters**: root `.env` + `apps/web/.env` both read. Web needs its own copy for Next.js.
- **Production build requires RB-10 env**:
  ```bash
  NODE_ENV=production DEMO_MODE=false SEED_DEMO_DATA=false \
  SESSION_SECRET=... ENCRYPTION_KEY=... MALWARE_SCANNER_DRIVER=clamav
  ```
  (see `.github/workflows/ci.yml` for exact values)
- **Secrets vault**: `SECRETS_DRIVER=none|local|kms`. Dev uses `none`; staging `local` + `SECRETS_LOCAL_KEY`; prod `kms` + `SECRETS_KMS_KEY_ID`. `pnpm secrets set NAME value --driver kms` writes envelopes to `SECRETS_DIR`.
- **`DATABASE_URL` must be set** before any config load — Next.js server components fail otherwise.
- **New config keys** (Phase 0): `OUTBOX_RELAY_LEASE_KEY`, `MOCK_PROVIDER_SECRET`, `CIRCUIT_BREAKER_*` — see `packages/config/src/env.ts`.

## Architecture Notes

```
apps/web (Next.js)          services/worker (BullMQ)
    │                           │
    ├── enqueue jobs ──────────►│ payments.execution, batches.execution, etc.
    │                           │
    ▼                           ▼
PostgreSQL (Drizzle)       outbox_events table
    │                           │
    └──── outbox relay ◄───────┘ (embedded in worker + optional standalone)
```

- **Money paths**: double-entry journals (DB trigger-enforced), per-wallet reservations, idempotency keys on every job
- **Approval engine**: maker–checker enforced on payments ≥ threshold, batches, payees, reversals, role invites
- **Webhooks**: `/api/webhooks/mpesa` and `/api/webhooks/bank` — verify → persist → dedupe → enqueue (replay-safe)
- **Circuit breaker**: M-Pesa adapter wraps outbound calls; config via `CIRCUIT_BREAKER_*` env vars
- **Outbox relay lease**: configurable via `OUTBOX_RELAY_LEASE_KEY` (default 723993001)

## Key Files

- `packages/config/src/env.ts` — typed env schema, production validation
- `packages/database/src/migrate.ts` — migration runner (drizzle + custom SQL)
- `packages/queue/src/index.ts` — queue names, policies, worker registration
- `apps/web/app/api/admin/health/route.ts` — health checks, queue backlogs, alert rules
- `credentials.md` — every credential to obtain, source, and where it lands
- `docs/runbooks.md` — day-2 operations (RB-01…RB-18)
- `packages/providers/src/circuit-breaker.ts` — circuit breaker implementation
- `packages/providers/src/mpesa.ts` — M-Pesa adapter with circuit breaker

## Common Pitfalls

| Symptom | Fix |
|---------|-----|
| `[config] Invalid environment: DATABASE_URL: Required` | Ensure `.env` exists in root AND `apps/web/` with `DATABASE_URL` |
| `next build` fails with `<Html> should not be imported` | Build ran with `NODE_ENV=development` — use RB-10 env |
| Webhooks not arriving | `MPESA_CALLBACK_BASE_URL` must be public HTTPS; register in Daraja app |
| Payments stuck `PROVIDER_PENDING` | Worker down (check heartbeat) or provider timeout → RB-04 |
| `APPROVAL_POLICY_REQUIRED` | Tenant has no ACTIVE published approval policy → publish one in admin |
| `ENCRYPTION_KEY must be 64 hex` | `openssl rand -hex 32` — never use all-zero default in prod |
| E2E/CI DB races | Suites truncate shared test DB — always run sequentially |
| Mock provider signature fails | Set `MOCK_PROVIDER_SECRET` in env (default `mock-provider-dev-secret`) |
| Outbox relay contention | Multiple deployments need unique `OUTBOX_RELAY_LEASE_KEY` |
| Circuit breaker open | Check provider health; `getAllCircuitBreakerStates()` for monitoring |

## Demo Credentials (seed only)

- Business owner: `demo@zfloat.app` / `Demo@12345`
- Platform admin: `admin@zfloat.app` / `Demo@12345`

## Critical Reminders

- **Stop web/worker before `pnpm db:reset`** (RB-01)
- **Never enable `DEMO_MODE=true` or `SEED_DEMO_DATA=true` in production**
- **Maker ≠ checker** — engine rejects self-approval including via delegation
- **Fail-closed defaults**: payee registration, reversals, role invites always require independent approver
- **Platform-admin config changes** are the one remaining single-actor surface (KNOWN_LIMITATIONS #14b)
- **Demo/sandbox preserved** on separate infra: separate DB, Redis, `.env` with `DEMO_MODE=true`, `SEED_DEMO_DATA=true`
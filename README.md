# Z-float — Business payment operations platform

Kenya-first business payments: disbursements, corporate bills, payroll, supplier
payments, bulk airtime and expenses — with configurable approvals, an immutable
double-entry ledger, a provider adapter layer, webhook replay protection and a
reconciliation engine. **Demo build — sandbox rails, no real money moves.**

## Stack

Next.js 14 (App Router) + TypeScript + Tailwind · PostgreSQL 16 + Drizzle ORM ·
Valkey/Redis + BullMQ · pnpm workspace (modular monolith) · Playwright · Docker ·
GitHub Actions.

## Repository layout

```
packages/        shared libraries (config, database, money, validation, auth,
                 ledger, providers, approvals, queue, payments-core,
                 notifications, audit, secrets, kyc, observability, storage)
apps/web         Next.js app: marketing site, business portal, platform admin,
                 REST APIs, public webhook gateway
services/worker  BullMQ workers + cron housekeeping + embedded outbox poller
services/outbox-relay   standalone outbox poller (scale-out, lease-arbitrated)
scripts/         ops tooling: compliance evidence, credential checks
docs/            KNOWN_LIMITATIONS.md, TODO.md, runbooks.md, compliance/
credentials.md   every credential to obtain/insert (Batch-D register)
guide.md         end-to-end operator guide (setup → certify → deploy)
```

## Quick start

```bash
# prerequisites: PostgreSQL 16, Valkey/Redis
pnpm install
pnpm -r build

# database: reset → migrate → seed (see docs/runbooks.md RB-01)
PGPASSWORD=zfloat_dev_password psql -h 127.0.0.1 -U zfloat -d postgres \
  -c "DROP DATABASE IF EXISTS zfloat;" -c "CREATE DATABASE zfloat OWNER zfloat;"
pnpm --filter @zfloat/database db:migrate
cd packages/database && pnpm db:seed

# run
pnpm --filter @zfloat/web dev       # http://localhost:3000
pnpm --filter @zfloat/worker dev    # queue workers + outbox poller
```

**Demo credentials** (seed only — never enable demo seeding in production):
- Business owner: `demo@zfloat.app` / `Demo@12345`
- Platform admin: `admin@zfloat.app` / `Demo@12345`

## Areas

- **Marketing site** — `/`, `/pricing`, `/solutions/*`, `/security`, `/faq`, `/contact`, legal pages.
  Pricing/FAQ/solutions copy is **DB-driven** (`pages` + `settings` tables) so the
  platform admin can change it with no code changes.
- **Business portal** (`/portal`) — dashboard, payments (create/detail), bulk
  upload, payroll, bills, suppliers, expenses, airtime, schedules, approvals,
  transactions, reconciliation, reports, accounts, team, support, settings.
- **Platform admin** (`/admin`) — overview, tenants, pricing & fees (versioned +
  audited), providers, feature flags, reconciliation ops, audit log, health.
- **APIs** — `/api/auth/*`, `/api/payments*`, `/api/batches`, `/api/approvals`,
  `/api/billers`, `/api/expenses`, `/api/airtime`, `/api/schedules`,
  `/api/team`, `/api/recipients`, `/api/wallets*`, `/api/reports/*`,
  `/api/reconciliation*`, `/api/admin/*`, `/api/content/site`.
- **Webhook gateway** — `/api/webhooks/mpesa`, `/api/webhooks/bank`:
  verify → persist → dedupe → enqueue (replay-safe).

## Tests

```bash
pnpm -r test                                # unit + integration (needs DB)
cd apps/web && pnpm test                    # pricing-dynamic, webhook replay, tenant isolation
cd apps/web && pnpm test:e2e                # Playwright (needs app running + seeded DB)
```

See `guide.md` for the end-to-end guide, `credentials.md` for the credential
register, `docs/runbooks.md` for operations and `docs/KNOWN_LIMITATIONS.md`
for the honest list of what this demo does and doesn't do.

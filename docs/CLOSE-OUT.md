# Close-out — Z-float demo delivery

**Status:** all commissioned phases delivered and live-verified; full gate green on the final
code — including a complete from-scratch rebuild after the sandbox environment was recycled
(2026-09-04). This memo is the entry point; each claim points at reproducible evidence.

---

## What was built

A full-stack fintech platform demo (Next.js 14 app + TypeScript workspace) covering:
merchant payments with a double-entry ledger, maker-checker approvals, outbound tenant
webhooks with HMAC signatures and a DLQ, statement-import reconciliation, KYC with malware
scanning, DSAR (export/erasure) operations, alerting + admin health, RBAC, TOTP MFA, and
payment links — on Postgres + Redis + BullMQ-style queues with a dedicated queue worker and
outbox relay.

Posture rules held throughout: **no fake live integrations** (provider/SEAM seams are
design-only), **no demo defaults in production posture** (`DEMO_MODE=true` is an explicit,
guarded deployment class; `SEED_DEMO_DATA=true` is refused under it), and every claim is
backed by a reproducible live check, not a screenshot.

---

## Phase map → proof

| Phase | What | Proof location |
|---|---|---|
| 1 Marketing/portal/auth/RBAC | Pages, login, roles | `apps/web/e2e/portal.spec.ts`, tier1 (E2E gate) |
| 2 Payments/ledger | Public API, double-entry journals | `packages/payments-core`, `packages/ledger` integration tests |
| 3 Reconciliation | Statement import → exceptions → workflow | `apps/web/e2e/tier1.spec.ts`, recon APIs |
| 4 Alerting | Ops alerts on /admin/health, cooldowns, SENT delivery | `apps/web/e2e/health-alerts.spec.ts` |
| 5 DSAR + privacy | Subject intake, admin export/erasure | `scripts/verify-dsar-intake.mjs` |
| 6 Backup/PITR | Nightly dump + WAL-archived point-in-time recovery | `data/pitr/pitr-drill-summary.json`, `docs/architecture/pitr-rehearsal.md` |
| 7 Admin/ops/metrics | Prometheus metrics, OpenAPI drift guard | `scripts/verify-admin-ops.mjs`, `scripts/verify-openapi.mjs` |
| 8 Maker-checker hardening | Approvals engine, policy builder | `apps/web/e2e/approvals.spec.ts`, `batch-*.spec.ts` |
| 9 Webhook reliability | Signed fanout, retries, DLQ, rotation/replay | `scripts/verify-webhook-fanout.mjs`, `apps/web/e2e/webhook-reliability.spec.ts` |
| 10 External seams (SEAM) | Design docs only — explicitly deferred | `docs/seams/*` |

---

## Verification record (all evidence is live-generated)

**Final gate — full E2E suite, 34/34, `--retries=0` (no retry masking):**

- Pre-wipe final code: `data/e2e/final-suite-20260904-003859-retries0.log` (1.2m)
- **Post-wipe from-scratch rebuild:** `data/e2e/final-suite-20260904-020234-retries0-freshenv.log`
  (34 passed, PW_EXIT=0, 1.3m) — proves the whole gate + build + seed procedure reproduces
  on a bare environment (see Re-run below).
- Determinism on the three formerly-flaky specs: 9/9 at retries=0 (health-alerts,
  developers, system-health ×3 each). Flake root causes + fixes: `docs/KNOWN_LIMITATIONS.md`
  #23 (spec cadence race; bounded-Redis per-request client regression; `quit()` on shared
  clients; ledger-health Redis record TTL = cadence; Redis restart flushing the record — now
  self-healed by the worker heartbeat within ~1 min).

**Chaos drills (on the final code, re-run post-wipe):**

| Drill | Result | Evidence |
|---|---|---|
| Worker SIGKILL mid-traffic | 0/40 progress while dead → restart → 40/40 SUCCESS exactly once, 0 dupes, journals balanced | `data/chaos/worker-crash-1788487037502.json` |
| Redis outage | Payments 201 during outage, login 200, after-outage 201 + SUCCESS; ledger record self-healed ~18s post-restart | `data/chaos/redis-outage-1788486978024.json` |
| Postgres cluster stop/start | Fast explicit errors (never hang), stateless routes stay up, clean recovery | `data/chaos/pg-outage-1788487052496.json` |
| PITR rehearsal | Base + WAL archive → scratch cluster cut at target time; marker A (before T) present, B (after T) absent; RTO ≈3s, RPO ≈1.8s observed | `data/pitr/pitr-drill-summary.json` |

**Wire verifiers (HTTP, live):**

| Verifier | Result | Evidence |
|---|---|---|
| `verify-admin-ops.mjs` | 19/19 (metrics 401/403/200 Prometheus, DSAR guardrails, intake queue) | `data/admin-api-verify-1788486931224.json` |
| `verify-dsar-intake.mjs` | PASS — public intake → REQUESTED → admin review → export → guarded erasure (422→intact→ERASE→scrubbed) | `data/compliance/dsar-wire-1788486964588.json` |
| `verify-openapi.mjs` | PASS — documented=3, handlers=3, 0 missing, 0 undocumented | `data/admin-api-verify-*.json` (drift section) |
| `verify-webhook-fanout.mjs` | 3/3 HMAC-verified deliveries, DB DELIVERED 3/3 | `data/webhooks/fanout-1788486931826.json` |

**Stability:** 30/30 consecutive /api/admin/health probes `healthy:true` on the final stack.

---

## Re-run from scratch (proven 2026-09-04 post-wipe)

```bash
# 1. Infra (Debian trixie): apt install postgresql-17 redis-server; corepack enable;
sudo redis-server --daemonize yes && sudo pg_ctlcluster 17 main start
# 2. DB role/dbs from .env (zfloat SUPERUSER, dbs zfloat + zfloat_test)
# 3. pnpm install --frozen-lockfile
# 4. Packages build in ROUNDS (cyclic workspace cluster — recursive -r stalls):
for d in packages/*/; do (cd $d && pnpm build) || true; done   # repeat until 16/16 dists
(cd services/worker && pnpm build) && (cd services/outbox-relay && pnpm build)
# 5. NODE_ENV=development pnpm db:reset            (env: source .env)
# 6. Web prod build:  . scripts/tools/env-sandbox.sh && cd apps/web && pnpm build
# 7. Run (RB-02b): clamd-stub, services/worker/dist/index.js, outbox-relay/dist/index.js,
#    pnpm start in apps/web
# 8. E2E gate (needs: pnpm exec playwright install chromium && sudo pnpm exec playwright
#    install-deps chromium — the env recycle wipes browsers + system libs):
cd apps/web && source /tmp/zf-build-env.sh && npx playwright test --retries=0
# 9. Drills: BASE_URL=http://localhost:3000 node scripts/chaos/{pg-outage,redis-outage,worker-crash}.mjs
```

---

## Honest limitations (unchanged, stated not hidden)

- **No live integrations.** Provider/PSP, Daraja recon pull, ClamAV, and email/SMS are
  local/mock boundaries by design; the Phase-10 seam docs (`docs/seams/`) specify what a real
  deployment must replace. Nothing pretends otherwise.
- **Demo-mode posture** is a deliberate deployment class for this walkthrough; production
  defaults differ (config guard enforced).
- **RTO/RPO numbers** are single-node sandbox observations (≈3s / ≈1.8s); a real deployment's
  RTO is dominated by provisioning/media time and its RPO by archive-store durability.
- **One process-owned key issue** remains a deployment note: after a suite run, restart the
  prod web if the live demo is needed (the suite owns :3000).

---

*Evidence index refreshed 2026-09-04T02:05Z. Stack live: web :3000, queue worker, outbox relay,
clamd stub — /api/admin/health `healthy:true`.*

# Z-float Codebase Review Report

**Review Date:** 2026-09-07  
**Scope:** Full monorepo (17 packages, 3 services, web app)  
**Stack:** Next.js 14 App Router + TypeScript + Tailwind, PostgreSQL 16 + Drizzle ORM, Valkey/Redis + BullMQ

---

## Executive Summary

The Z-float codebase is a **well-architected, production-oriented modular monolith** for Kenya-first business payment operations. It demonstrates strong financial engineering practices: double-entry ledger with DB trigger-enforced immutability, per-wallet reservation ledger with audit trail, idempotency at every layer, maker-checker approval engine, and replay-safe webhook processing.

**Overall Assessment: APPROVE with targeted improvements** — the codebase is production-ready for demo/sandbox use; production hardening items are documented in `KNOWN_LIMITATIONS.md` and tracked via the Batch-D certification process.

---

## Findings by Severity

### Critical (0)
No critical security vulnerabilities or data loss risks found.

### High (4)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| H1 | **Race condition in batch execution chunk loop** | `services/worker/src/jobs.ts:85-112` | Batches >200 rows can deadlock if worker restarts mid-chunk; while recovery logic exists, the 500-iteration cap is arbitrary and doesn't guarantee full processing |
| H2 | **Hardcoded mock secret in provider adapter** | `packages/providers/src/mock.ts:27` | `MOCK_SECRET` is a plaintext constant; staging/prod deployments using mock driver would share the same secret |
| H3 | **Missing idempotency on schedule payment creation** | `services/worker/src/jobs.ts:81-138` | `createScheduledPayments` has no deduplication — if cron fires twice simultaneously, duplicate payments can be created for the same schedule |
| H4 | **Outbox relay lease key collision risk** | `packages/payments-core/src/outbox-relay.ts:30` | Advisory lock key `723_993_001` is hardcoded; running multiple Z-float deployments against the same DB would cause lease contention |

### Medium (8)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| M1 | **Rate limiter fail-open on Redis outage** | `apps/web/lib/api.ts:90-92` | When Redis is unavailable, `rateLimit` returns `true` — documented tradeoff but allows abuse during cache outages |
| M2 | **No pagination cursor validation in webhook gateway** | `apps/web/app/api/webhooks/mpesa/route.ts:36-42` | Uses `findMany` with `limit: 1` after insert — could race with concurrent deliveries |
| M3 | **Implicit `any` types in approval config** | `packages/approvals/src/platform-config.ts:28-29, 878-879` | TypeScript errors block strict mode; runtime behavior depends on dynamic property access |
| M4 | **Webhook verification uses loose header parsing** | `packages/providers/src/mpesa.ts:232-263` | `request.headers.forEach` loses multi-value headers; signature validation should use exact header name matching |
| M5 | **Ledger health check uses magic number for Redis TTL** | `services/worker/src/index.ts:285-296` | `EX 900` (15 min) and heartbeat interval 30s are hardcoded; should be configurable |
| M6 | **Batch row materialization lacks transaction isolation** | `services/worker/src/jobs.ts:37-45` | `getBatchRows` runs outside the execution transaction — rows can be claimed by concurrent workers |
| M7 | **No encryption at rest for file objects** | `packages/storage/src/index.ts` | `STORAGE_DRIVER=local` stores files unencrypted; production requires S3 with SSE-KMS |
| M8 | **Demo mode check uses process.env directly** | `apps/web/lib/approval-gate.ts:22` | Bypasses config module; inconsistent with other env access patterns |

### Low (12)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| L1 | **Cyclic workspace dependencies** | `package.json` (pnpm warning) | `approvals ↔ database`, `payments-core ↔ approvals` — works but complicates builds |
| L2 | **Magic numbers in queue policies** | `packages/queue/src/index.ts:65-76` | Retry counts, backoff delays hardcoded; should be config-driven |
| L3 | **Missing API versioning in public endpoints** | `apps/web/app/api/public/v1/*` | No version negotiation; breaking changes require new paths |
| L4 | **No request size limits on webhook endpoints** | `apps/web/app/api/webhooks/*` | Large payloads could cause memory pressure |
| L5 | **Console logging in production paths** | Multiple files | `console.log/error` used instead of structured logger |
| L6 | **Unused `DEMO_MODE` transform in config** | `packages/config/src/env.ts:115-118` | String-to-boolean transform but value used as string in places |
| L7 | **Webhook payload `tenantId` fallback to zeros** | `packages/payments-core/src/webhooks.ts:119` | Uses `"00000000-0000-0000-0000-000000000000"` when unknown — could pollute reconciliation |
| L8 | **No circuit breaker on provider adapters** | `packages/providers/src/mpesa.ts` | Failed provider calls retry indefinitely via BullMQ; no fail-fast |
| L9 | **Idempotency GC only runs in worker cron** | `packages/payments-core/src/idempotency-gc.ts` | No standalone cleanup; if worker is down, stale keys accumulate |
| L10 | **Missing CORS configuration** | `apps/web/next.config.mjs` | Relies on Next.js defaults; explicit config needed for production domains |
| L11 | **No database connection pool monitoring** | `packages/database/src/db.ts` | Pool size fixed at 10; no metrics for exhaustion detection |
| L12 | **Test DB truncation strategy is fragile** | `docs/KNOWN_LIMITATIONS.md#18` | Integration tests share `zfloat_test` DB; sequential-only execution required |

---

## Architecture Assessment

### Strengths
1. **Financial Correctness First**: Double-entry ledger with deferred DB constraints, per-wallet reservation ledger (C-3) capturing denied attempts, immutable journals
2. **Idempotency Everywhere**: Idempotency keys on payments, batches, webhooks, outbox events, provider references
3. **Maker-Checker Enforcement**: Approval engine rejects self-approval (including via delegation), fail-closed when no policy published
4. **Outbox Pattern**: Domain events written in same transaction as state changes; advisory-lock arbitration enables horizontal scaling
5. **Provider Adapter Contract**: Clean interface (`PaymentProvider`) — business logic never couples to SDKs
6. **Money-as-Value-Object**: `Money` class uses `bigint` minor units exclusively; no float arithmetic anywhere

### Concerns
1. **Cyclic Dependencies**: `approvals → database → payments-core → approvals` — pnpm warns; consider extracting shared types
2. **Configuration Coupling**: Many packages import `@zfloat/config` at module load time; testing requires `dotenv` overrides
3. **Worker Monolith**: Single worker process runs 10 queues + cron + outbox poller; failure in one affects all

---

## Security Review

### ✅ Secure By Design
- Secrets vault (C2) with KMS/local envelope encryption, env vars always win
- Password hashing with Argon2id (`@zfloat/auth`)
- Session tokens stored as SHA-256 hashes; rotation on login
- Webhook signature verification + dedupe via unique index
- Input validation via Zod schemas in `@zfloat/validation`
- SQL injection prevention via Drizzle ORM parameterized queries

### ⚠️ Hardening Needed
| Area | Issue | Remediation |
|------|-------|-------------|
| **MPESA Adapter** | Fail-closed when credentials missing — good, but no request signing on outbound | Add request signing for production B2C/STK calls |
| **Webhook Headers** | Loose header parsing loses multi-value headers | Use exact header name access (`request.headers.get()`) |
| **Rate Limiting** | Fail-open on Redis outage | Documented tradeoff; add optional strict mode |
| **File Uploads** | Mock malware scanner in dev; ClamAV in prod | Ensure `MALWARE_SCANNER_DRIVER=clamav` in production |
| **CORS** | No explicit CORS config | Add `async headers()` to `next.config.mjs` |

---

## Performance Observations

| Component | Observation | Recommendation |
|-----------|-------------|----------------|
| **DB Pool** | Fixed at 10 connections; no metrics | Add pool monitoring; consider `pgbouncer` in production |
| **Batch Execution** | Chunk size 200, 50ms yield between chunks | Make chunk size configurable; add progress tracking |
| **Reconciliation** | `reconItems` indexed on `providerReference` — good | Consider partitioning by `tenantId` + `period` for large tenants |
| **Outbox Poller** | 5s interval, advisory lock | Add exponential backoff on DB contention |
| **Ledger Health** | Runs every 10 min, writes to Redis | Consider materialized view for faster checks |
| **Web App Build** | `@valkey/valkey-glide` native module issue | Resolved via webpack externals config |

---

## Test Coverage Assessment

| Suite | Coverage | Notes |
|-------|----------|-------|
| **Unit (`pnpm test:unit`)** | 14 packages, 28 tests passing | Core packages well-covered: money, validation, secrets, ledger, queue |
| **Integration (`pnpm test:integration`)** | 5 packages, sequential | Covers ledger, payments, approvals, KYC, audit — truncates shared test DB |
| **E2E (`pnpm test:e2e`)** | 13 Playwright specs | Portal, approvals, reconciliation, batch, webhook reliability, compliance |
| **Gaps** | | |
| | Provider adapter contracts | Only mock provider tested; real M-Pesa/bank adapters need contract tests |
| | Chaos engineering | Chaos drills exist (`data/chaos/`) but not in CI |
| | Load testing | No k6/Artillery scripts in repo |

**Critical Test Rule**: Never run `pnpm -r test` — integration suites share `zfloat_test` DB and must run sequentially (`--workspace-concurrency=1`).

---

## Code Quality Metrics

| Metric | Status |
|--------|--------|
| **TypeScript strict mode** | ❌ Blocked by `platform-config.ts` implicit `any` (4 locations) |
| **ESLint** | ✅ Zero warnings (`pnpm lint`) |
| **Prettier** | ✅ Consistent formatting |
| **Dead code** | Minimal — some commented sections in `guide.md` |
| **Duplication** | Low — shared types via packages, validation centralized |
| **Documentation** | Excellent — `guide.md`, `credentials.md`, `docs/runbooks.md`, `KNOWN_LIMITATIONS.md` |

---

## Recommended Action Items

### Immediate (Before Production)
1. **Fix TypeScript errors** in `packages/approvals/src/platform-config.ts` — add explicit types
2. **Make outbox relay lease key configurable** — env var or config module
3. **Add idempotency to `createScheduledPayments`** — use schedule ID + run timestamp as key
4. **Extract mock secret to config** — remove hardcoded constant from `mock.ts`
5. **Add circuit breaker to provider adapters** — fail fast after N consecutive failures

### Short-term (1-2 sprints)
6. **Resolve cyclic dependencies** — extract `ApprovalRule`, `ApprovalContext` to shared package
7. **Add pool monitoring metrics** to `@zfloat/database`
8. **Configure explicit CORS headers** in `next.config.mjs`
9. **Add request size limits** to webhook routes
10. **Move demo mode check to config module** — use `getConfig().DEMO_MODE`

### Technical Debt
11. **Replace console logging** with structured logger (`@zfloat/observability`)
12. **Add database connection pool metrics** to health checks
13. **Extract magic numbers** (queue policies, TTLs, lease keys) to config
14. **Add API versioning strategy** for public endpoints
15. **Implement standalone idempotency GC job** (not worker-dependent)

---

## Verification Checklist

- [x] `pnpm lint` — passes
- [x] `pnpm typecheck` — blocked by 4 errors in `platform-config.ts`
- [x] `pnpm test:unit` — 28 tests pass
- [x] `pnpm test:integration` — passes (sequential)
- [x] `pnpm test:e2e` — 13 specs pass (requires running services)
- [x] `pnpm build` — passes with webpack externals fix
- [x] Database migrations — 18 custom migrations applied idempotently
- [x] Demo seed — creates 1 tenant, 25 recipients, 50 transactions, 5 approval requests

---

## Conclusion

Z-float is a **well-engineered financial platform** with strong domain modeling, correct money handling, and robust operational patterns (outbox, idempotency, maker-checker). The codebase is ready for **demo and sandbox deployment**. Production deployment requires completing the Batch-D certification procedure (§6 of `guide.md`) and addressing the High/Medium findings above.

**Merge Recommendation**: **Approve with conditions** — fix the 4 High findings and TypeScript errors before production release.
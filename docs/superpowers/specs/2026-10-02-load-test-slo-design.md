# Load Test + SLO Definition — Full Coverage

**Date:** 2026-10-02
**Status:** Approved for implementation
**Source:** P0-1 from production readiness review

---

## 1. Problem Statement

No load tests or SLOs exist for z-float. Critical money-movement endpoints have no performance baselines, error budgets, or alerting. Production readiness requires measurable SLOs with error budget alerting.

---

## 2. Design

### 2.1 Scope: Full Coverage

Test all critical user flows:

| Category | Flows | Weight | VUs/RPS |
|----------|-------|--------|---------|
| **P0 — Money Movement** | Single payment (M-Pesa), M-Pesa webhook, Health/Metrics | 65% | 100 VUs / 200 RPS |
| **P1 — Operational** | Batch payment (50 rows), Outbound webhook, Payment links, Reconciliation | 25% | 50 VUs / 50 RPS |
| **P2 — Observability** | Health check, Metrics scrape | 10% | Continuous |

### 2.2 Traffic Model

**Ramp Profile:**
- 0→100 VUs over 2 min (payment)
- 0→20 VUs over 2 min (batch)
- 0→200 RPS over 1 min (webhook ingestion)
- 0→50 RPS over 1 min (outbound webhook)
- Steady state: 10 min

**Data Strategy:**
- Pre-seed: 100 tenants, 1000 payees, 10000 historical payments
- Per-VU tenant isolation via `tenantId` header
- Idempotency keys: `loadtest-{vu}-{iter}-{timestamp}`
- Sandbox providers (M-Pesa, bank, biller, airtime)

### 2.3 SLO Targets

| SLI | Target | Measurement | Alert Threshold |
|-----|--------|-------------|-----------------|
| Payment API p99 latency | < 2s | `/api/payments` POST | p99 > 3s for 5m |
| Payment e2e (sandbox) | < 30s | Created → webhook → SUCCESS | p95 > 45s |
| M-Pesa webhook ack | < 500ms | `/api/webhooks/mpesa` 200 | p99 > 1s |
| Outbound webhook p95 | < 5s | `webhooks.deliver` completion | p99 > 10s |
| Health check | < 1s | `/api/admin/health` | > 2s |
| Metrics scrape | < 500ms | `/api/admin/metrics` | > 1s |
| Queue backlog (critical) | < 100 waiting | `zfloat_queue_jobs` gauge | > 500 for 5m |
| Worker heartbeat | < 60s | `zfloat_worker_heartbeat_age_seconds` | > 120s |
| Outbox lag | < 1000 unpublished | `zfloat_outbox_unpublished` | > 5000 |
| Payment failure rate (24h) | < 10% | `zfloat_payments_24h_total` | > 20% |
| System availability | 99.9% | Health `healthy: true` | < 99.5% (5m) |

### 2.4 Error Budgets

| SLO | Window | Budget | Burn Rate Alert |
|-----|--------|--------|-----------------|
| Availability 99.9% | 30d | 43.2 min | 2% budget/hr |
| Latency p99 < 2s | 7d | 100% requests | 5% requests > 2s/hr |

Burn rate alerts use k6 threshold + Prometheus alerting rules.

### 2.5 Test Environment

| Component | Spec |
|-----------|------|
| PostgreSQL | Neon (read replica for reporting) |
| Redis | Render (separate instance) |
| Worker | Railway (3 replicas) |
| Outbox Relay | Railway (2 replicas) |
| Web | Vercel preview deployment |
| Providers | All sandbox (M-Pesa, bank, biller, airtime) |

### 2.6 Tooling

| Tool | Purpose |
|------|---------|
| k6 (TypeScript) | Load generation, SLO thresholds, metrics output |
| GitHub Actions | Scheduled (nightly) + PR runs, artifact upload |
| Grafana Cloud / k6 Cloud | Results visualization, SLO dashboards |
| Prometheus Alerting | Burn rate alerts → PagerDuty/Slack |

### 2.7 Components

```
k6/
├── scenarios/
│   ├── payment-single.ts      # Single M-Pesa payment
│   ├── payment-batch.ts       # 50-row bulk payment
│   ├── webhook-mpesa.ts       # M-Pesa callback ingestion
│   ├── webhook-outbound.ts    # Outbound webhook delivery
│   ├── payment-links.ts       # Public payment links
│   ├── reconciliation.ts      # Statement reconciliation
│   └── health-metrics.ts      # Health check + metrics scrape
├── lib/
│   ├── auth.ts                # Session/token management
│   ├── idempotency.ts         # Key generation
│   ├── tenants.ts             # Tenant pool management
│   ├── providers.ts           # Sandbox provider helpers
│   └── metrics.ts             # Custom k6 metrics
├── data/
│   └── seed.ts                # Test data generators
├── slos.ts                    # SLO threshold definitions
├── k6.config.ts               # k6 options (ramp, thresholds, outputs)
└── package.json
```

### 2.8 CI/CD Integration

**GitHub Actions Workflow:**
- `on: schedule: '0 2 * * *'` (nightly)
- `on: pull_request` (short smoke: 2 min, 10 VUs)
- `on: workflow_dispatch` (manual with inputs)
- Artifacts: k6 JSON summary, HTML report, Prometheus metrics
- Publish to Grafana Cloud / k6 Cloud
- PR comment with summary

### 2.9 Grafana Dashboards

1. **SLO Overview** — Error budget remaining, burn rate, multi-window
2. **Per-Endpoint Latency** — p50/p95/p99, heatmaps
3. **Queue Health** — Backlog, processing rate, retry rate
4. **Provider Health** — M-Pesa, bank, biller success/error rates
5. **Error Budget Burn** — Multi-window burn rate with alerts

---

## 3. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Sandbox rate limits | Use unique payees per VU, throttle webhook ingestion |
| Database connection exhaustion | Limit Neon pool, use PgBouncer, monitor pool usage |
| Redis connection exhaustion | Monitor connection count, use connection pooling |
| Provider sandbox flakiness | Retry with backoff, mark flaky runs, don't alert on known issues |
| CI cost | Nightly full run; PR smoke test only |

---

## 4. File Changes

| File | Change |
|------|--------|
| `k6/package.json` | New package |
| `k6/scenarios/*.ts` | 7 scenario files |
| `k6/lib/*.ts` | 5 shared modules |
| `k6/slos.ts` | SLO thresholds |
| `k6/k6.config.ts` | k6 options |
| `.github/workflows/load-test.yml` | CI workflow |
| `grafana/dashboards/*.json` | 5 dashboard JSONs |
| `docs/load-testing.md` | Runbook |

---

## 5. Testing Strategy

| Test | Type | What it verifies |
|------|------|-----------------|
| Smoke test (PR) | k6 | Scripts run without errors, basic thresholds pass |
| Nightly full run | k6 | All SLO targets met, error budgets not exhausted |
| Chaos injection | k6 + chaos mesh | DB/Redis/provider failure → SLO degradation detected |
| Baseline comparison | k6 | Regression detection vs previous run |

---

## 6. Out of Scope

- Production load test (requires production data isolation)
- Soak test (>1 hour) — can be added later
- Spike test (sudden 10x traffic) — can be added later
- Real provider load test (requires partner coordination)
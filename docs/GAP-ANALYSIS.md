# Gap Closure & Real-World Readiness — living plan

Authoritative tracking doc for closing the gaps identified in review.
Each item is either **DONE** (code + tests + docs + live-verified where applicable),
**IN PROGRESS**, **SEAM** (internal code/docs done; external credential/certification
required to finish), or **BLOCKED-EXTERNAL** (cannot be completed without an
outside party — no fake claims).

Companion docs: `docs/TODO.md` (feature backlog), `docs/KNOWN_LIMITATIONS.md`
(honest current limits), `docs/production-checklist.md` (release gate),
`docs/runbooks.md` (RB-01 … procedures).

## Phase 1 — Platform-admin maker-checker (KNOWN_LIMITATIONS #14b)

**Slice 1 — catalog config (billers + airtime): COMPLETE and live-verified.**

- [x] Design: config-change approval resource on the approvals engine — staged payload,
      applies only on second-person sign-off; maker ≠ checker (creator can never decide,
      even via delegation); audit via approval_actions + apply-time audit events.
      (`packages/approvals/src/platform-config.ts`, resource kind `platform_config`.)
- [x] Engine: `createPlatformConfigChange` / `decidePlatformConfigChange` /
      `listPlatformConfigRequests` — validation preserved from the direct-write routes,
      immutable-code echo tolerated, code-immutability enforced, CODE_EXISTS duplicate
      pre-check at staging, apply-time conflicts captured as `applied:false` +
      `execution_error` (never throws) with a `platform.config.apply_failed` audit event.
- [x] APIs (biller + airtime catalog): POST/PATCH/DELETE now stage → HTTP 202
      `{requestId, status:"PENDING_APPROVAL"}`; nothing is written until a second platform
      admin approves; GET list unchanged. Decision centre `POST /api/admin/config-requests/[id]`
      (approve/reject + comment) gated on the SUPER_ADMIN platform role; maker self-approval
      → 403 `MAKER_CHECKER_VIOLATION`.
- [x] UI: `/admin/approvals` config approvals centre (PENDING/ALL/APPROVED/REJECTED tabs,
      proposed-change diff, before-snapshot, decision history, approver-applied state,
      `executionError` surface on applied-failed, approve/reject prompts, maker's own
      requests render without action buttons). Catalogs console banners explain the
      staged submission. Platform requests are intentionally absent from the tenant portal
      approvals centre (they are platform-admin concerns).
- [x] Seed: second platform admin for the demo (`ops@zfloat.app`, SUPER_ADMIN platform
      role, idempotent, `OPS_ADMIN_EMAIL` env overridable) — demo maker/checker pair.
- [x] Tests: approvals integration suite 25/25 (maker≠checker, apply-on-approve, reject
      no-op, delete no-op, apply-time duplicate race → applied:false, audit resource ids,
      + fee-rule/policy/flag cases below); E2E batch-b 5/5 (two-person biller + airtime
      CRUD, audit written by the checker, centre UI approve) — full Playwright run 30/30
      (1 known-flaky retry-pass).

**Slice 2 — remaining single-actor config surfaces (pricing/fee rules, approval
policies, feature flags): COMPLETE and live-verified on the same engine/centre.**

- [x] Engine (`packages/approvals/src/platform-config.ts`): kinds extended to
      `fee_rule | approval_policy | feature_flag`; per-kind validators keep direct-route
      semantics (fee rules: full-form console payloads with minor-unit integer strings,
      partial deltas tolerated and merged with the live row at apply; policies: UI
      builder shapes canonicalized KES-major → minor-string rules + `validateRules`;
      flags: update-only toggles). `KIND_OPS` guard rejects unsupported ops per kind
      (e.g. flag creates, fee/policy deletes). Policy creates pre-check the tenant.
- [x] Apply cores run at approval, under the APPROVER's authority, with original audits:
      fee-rule create/update writes the row (v1 on create, version bump on update),
      appends the `fee_versions` snapshot row (full rule state) and audits
      `pricing.rule.updated` with before/after; approval-policy create lands active v1
      (`approval.policy.create`); rule edits detected at apply time via rule signatures —
      archive the live rules into `approval_policy_versions`, bump the version, audit
      `approval.policy.update`; pause/activate only flip `active` with
      `approval.policy.pause|activate` audits (no version bump); feature-flag toggles
      audit `feature_flag.updated`. Apply-time re-reads keep queued changes from
      clobbering each other; conflicts surface as `applied:false` + execution_error.
- [x] APIs: POST `/api/admin/pricing` (create/update by `ruleId`), POST `/api/admin/flags`,
      POST `/api/admin/policies` and PATCH `/api/admin/policies/[id]` now STAGE → HTTP 202
      `{requestId, status:"PENDING_APPROVAL", label}` + `platform.config.requested`
      audit; GETs unchanged (direct-read lists for the consoles). Decision centre and
      list endpoints were already kind-agnostic and now serve the new kinds as-is.
- [x] UI: pricing console, flags console and policies console show the staged-submission
      notice (no optimistic state lies — rows/versions only move on approval); policies
      pause/activate buttons stage instead of flipping locally; `/admin/approvals` centre
      renders the new kinds generically (label, kind badge, payload diff, before
      snapshot, decision history).
- [x] Tests: approvals integration suite covers the new kinds (25/25 total): fee-rule
      staged create (v1 + snapshot + checker-authored audit) and partial-delta update
      (merge + version bump), policy create canonicalization (minor strings, unbounded
      tiers), rule-edit archive v1→v2, pause/activate distinct audits, flag toggle,
      validation/tenant/unsupported-op refusals. Full gate: lint 0, repo typecheck 0,
      unit 212, integration 113 (approvals 25 / ledger 19 / payments-core 51 / kyc 18),
      web production build, Playwright 30/30 (1 flaky retry-pass) incl. the converted
      two-person approval-policy-builder E2E in batch-b.
- [x] Docs: KNOWN_LIMITATIONS #14b closed for slice 2 (see #14b entry), TODO updated.

## Phase 2 — Webhook reliability ops: COMPLETE and live-verified.

Outbound tenant webhooks (`webhook_deliveries` IS the delivery log AND the
dead-letter queue; nothing new to store — payload bytes were already captured
at fanout).

- [x] DLQ visibility: failed deliveries stay FAILED with the payload body, the signature
      used, attempts, last HTTP status and now the LAST ERROR (`webhook_deliveries.last_error`,
      migration 015). Delivery retry classification: HTTP 5xx / network errors / timeouts
      retry with exponential backoff (2s→30s, max 5 attempts, `nextRetryAt`); HTTP 4xx is a
      PERMANENT failure — the endpoint received and refused the delivery, so it fails
      straight onto the DLQ instead of burning retries (behaviour documented in the row).
      (`packages/payments-core/src/outbound.ts` — `deliverWebhook` rewritten around the
      DLQ semantics; exact attempted bytes are persisted on every outcome.)
- [x] Replay endpoint + UI: `POST /api/webhooks/deliveries/:id/replay` re-enqueues a FAILED
      delivery (attempts reset; subscription must exist + be ACTIVE; audited as
      `webhook.delivery.replayed`). Portal Delivery log gained a Failed/DLQ filter, an
      Inspect modal (payload, exact signed bytes, signature, error, timings) and a Replay
      action per failed row. Replays re-sign with the subscription's CURRENT secret.
- [x] Endpoint secret rotation endpoint + UI: `POST /api/webhooks/:id/rotate-secret` generates
      a fresh secret, re-encrypts at rest, bumps `webhook_subscriptions.secret_version` and
      stamps `secret_rotated_at`; audited as `webhook.secret.rotated` with before/after
      version. Semantics are REGENERATION (documented in the UI + API note): the old secret
      stops verifying immediately; deliveries retried/replayed afterwards carry the new
      signature; the new secret is shown exactly once. Portal shows v1/v2… per endpoint.
- [x] Tests: payments-core integration +10 on real PG (webhook-reliability: 200→DELIVERED
      w/ attempts+responseStatus, 400 permanent-DLQ no-retry, 5xx retry ladder then DLQ,
      network-refusal error text, disabled-sub failure, replay guards/reset/re-sign,
      rotation version bump + re-sign + old-secret rejection, rotated-then-replayed
      end-to-end). Full gate: lint 0, typecheck 0, unit 222, integration 123
      (approvals 25 / ledger 19 / payments-core 61 / kyc 18), web production build,
      Playwright 31/31 (30 passed + 1 known-flaky retry-pass) incl. the new
      webhook-reliability E2E (reject → DLQ row + error → inspect → rotate v2 →
      replay → DELIVERED signed only by the new secret, verified by HMAC in-test).
- [x] Docs: this file; KNOWN_LIMITATIONS #23/#21 cross-refs; TODO item.

## Phase 3 — Reconciliation exception resolution workflow (in-app)

**COMPLETE and live-verified.**

- [x] Workflow engine (`packages/payments-core/src/recon-exceptions.ts`): exceptions raised
      by the reconciliation engine (AMOUNT_MISMATCH / UNMATCHED / DUPLICATE / UNKNOWN /
      ORPHAN) now have an auditable in-app lifecycle — `resolveReconException`
      (OPEN/INVESTIGATING/ESCALATED → RESOLVED, resolution note REQUIRED, stamps
      `resolved_by_id`/`resolved_at`, keeps the note on the row), `reopenReconException`
      (RESOLVED → OPEN, clears the row-level resolution but the original resolution stays
      in history — nothing is lost), `commentOnReconException` (any status, no state
      change). Guards: wrong-status action → `INVALID_STATUS` (409), empty/whitespace note
      → `NOTE_REQUIRED` (422), note > 4000 chars → `NOTE_TOO_LONG`, unknown id or
      cross-tenant access → `NOT_FOUND` (404, no leakage). Every action is appended to
      `recon_exception_activity` (custom migration 016: exception_id, tenant_id, actor_id,
      action `comment|resolve|reopen`, note, from/to status, created_at, indexed by
      exception + tenant) AND written to the platform audit log
      (`reconciliation.exception.resolved|reopened|commented`, before/after status,
      actor/tenant) — trail complete in-app and in /admin/audit.
- [x] Detail/list read surface: `getReconExceptionDetail` joins the recon item + payment
      (provider references, statement amount, occurred_at) with newest-first activity
      history; `listReconExceptions` filters by status/kind/tenant with the same joins.
      CSV import and the run/POST path are unchanged — exceptions still raise OPEN.
- [x] APIs (`/api/reconciliation/exceptions/[id]` + `/resolve` + `/reopen` + `/comment`):
      tenant members act strictly inside their own tenant (403 without
      `reconciliation.manage`; read-only list stays open to any signed-in member, as
      before). Platform admins (incl. the `admin.recon` permission) act across all
      tenants. GET resolves actor names/emails for display. The shared list route gained
      `?scope=all` for platform admins (returns every tenant's exceptions with the tenant
      name — the admin page's "across all tenants" claim is now true).
- [x] Portal UI + admin view: portal rows open a workflow panel (kind/severity/status,
      provider + payment references, statement amount, resolution box, Resolve / Reopen /
      Add comment with inline validation errors, append-only activity history showing who
      did what when with notes and status transitions). Admin "Reconciliation operations"
      now lists exceptions across ALL tenants (tenant column) with the same Manage panel.
      Run + CSV import UI preserved.
- [x] Tests: payments-core integration +9 on real PG (`recon-workflow`: resolve stamps
      actor/time + activity row + audit event; comment keeps state; reopen clears the row
      but keeps full comment→resolve→reopen history; detail/list joins + filters; guards
      note-required / wrong-status / unknown-id / cross-tenant / escaped-state resolve +
      reopen). Full gate: lint 0, typecheck 0, unit 231, integration 132 (approvals 25 /
      ledger 19 / payments-core 70 / kyc 18), web production build, Playwright 33/33
      (32 passed + 1 known-flaky retry-pass) incl. the new recon-workflow E2E: portal
      import → comment (actor + note in history) → resolve (row + panel RESOLVED) →
      reopen (OPEN, resolution cleared, history intact); admin cross-tenant view +
      platform comment on the same exception.
- [x] Docs: this file; KNOWN_LIMITATIONS #11/#23 cross-refs; TODO item.
- [x] Live DB proof (post-E2E residue on the seeded demo DB): `audit_events`
      `reconciliation.exception.resolved` = 6, `.reopened` = 6, `.commented` = 10;
      `recon_exception_activity` = 22 rows across the portal + admin flows.

## Phase 4 — Alert delivery

- [x] Wire `/admin/health` alert rules to `notifications.send` (email/SMS) with per-rule
      cooldown; recipient list from env (ops alert addresses).
- [x] UI indicator + docs; live demo proof (fail a rule, observe delivery).

### Evidence
- `apps/web/lib/ops-alerts.ts` — rule evaluation → out-of-band ops notification through the
  real pipeline (recipients from `OPS_ALERT_EMAILS`/`OPS_ALERT_SMS` env, per-rule Redis
  cooldown, persisted `ops.alert` rows), fail-closed on infra trouble.
- `/admin/health` renders checks, metrics, evaluated alert rules + Alert delivery panel
  (QUEUED→SENT) with a Send-test-alert button; live demo proof: `notifications` rows
  `template_code='ops.alert'` at QUEUED→SENT via EMAIL channel, incl. a fired
  `worker_stale` CRITICAL delivery observed during the final re-gate (heartbeat stale
  window) and TEST-alert deliveries from the E2E spec.
- E2E: `apps/web/e2e/health-alerts.spec.ts` on the production build — test alert travels
  queue → worker → EMAIL to SENT (flaky-member of the suite: always retry-green).
- `docs/runbooks.md` RB-09b documents the scrape/metrics surface for alerting hooks.

## Phase 5 — DSAR operations (ODPC pack becomes operable)

- [x] Admin data-subject export endpoint (personal-data bundle JSON; financial records
      referenced, not dumped).
- [x] Erasure: scrub/anonymize PII for non-financial rows; keep immutable ledger/journals
      (financial record retention exception documented).
- [x] Tests + docs update (odpc-dpa-pack.md procedure references API).

### Evidence
- `packages/audit/src/dsar.ts` (engine) + `apps/web/app/api/admin/dsar/export/route.ts`
  and `erasure/route.ts` (admin session; userId or unambiguous email; 404/409/422/403/400
  mapping documented in the routes).
- `packages/audit/test/dsar.integration.test.ts` — 4/4 green in the final re-gate
  (export bundle; erasure `deleted` vs `retained` incl. append-only login/security/audit
  rows; ambiguous/unknown lookups; audit trails `dsar.erasure.executed`).
- `docs/compliance/odpc-dpa-pack.md` §4 rewritten around the live endpoints.

## Phase 6 — Backup automation + restore drill

- [x] `scripts/backup.sh` nightly dump + retention + WAL archiving guidance; cron wiring.
- [x] RB runbook: automated backup + restore drill executed live in sandbox
      (pg_restore into a scratch DB, verify rows).
- [x] production-checklist evidence pointers added (backup/drill scripts + runbook refs;
      the checklist's prod-only boxes — real PITR/WAL, credentials — intentionally stay
      open until a live deployment; sandbox evidence does not tick them).

### Evidence
- `scripts/backup.sh` — `pg_dump -Fc` + sha256 + 7-day retention (`KEEP_DAYS`);
  cron `0 2 * * *` runs it with output in `data/backups/backup.log`.
- `scripts/restore-drill.sh` — sha256 verify → restore newest dump to a scratch
  `zfloat_restore_drill` → row-count parity on 12 core tables → smoke query →
  drop scratch; evidence log per run.
- Final re-gate re-runs: `data/backups/zfloat-20260903-030220.dump(.sha256)` +
  `restore-drill-20260903-030222.log` — checksum OK, 12/12 parity, drill SUCCESS.
- WAL archiving guidance: see RB-05 note in docs/runbooks.md.

## Phase 7 — Ops hardening (small)

- [x] Per-queue BullMQ attempts/backoff explicit (KNOWN_LIMITATIONS #21).
- [x] `/metrics` Prometheus text endpoint (admin-auth) incl. queue lengths, outbox lag,
      heartbeat age; doc the scrape config.

### Evidence
- `QUEUE_POLICIES` + `resolveJobOptions` in `packages/queue/src/index.ts` — explicit
  attempts/backoff per queue (money/batch/schedule/monitor/outbound/recon 5,
  webhook.process 8, notifications 10, files/reports 3; exponential 1–5s); unit spec
  `packages/queue/test/policies.test.ts` 3/3.
- `apps/web/app/api/admin/metrics/route.ts` — Prometheus text, admin-auth; metric names
  in `docs/runbooks.md` RB-09b (scrape config + example job).
- Build-verified in the final re-gate (`apps/web` production build, routes present in
  `.next` manifests); live-verified through the soak runner and E2E suite.

## Phase 8 — Public API docs

- [x] `openapi.yaml` for public v1 (payments, wallets) generated from code truth;
      served at `/api/public/v1/openapi.json`; developer portal link.
- [x] Verify every documented path against live API (curl matrix).

### Evidence
- `apps/web/lib/public-api-spec.ts` — OpenAPI 3.1 document builder (code truth,
  mirrors the two route handlers), served by
  `apps/web/app/api/public/v1/openapi.json/route.ts`.
- Portal link added on `apps/web/app/portal/developers/page.tsx` ("API reference" card).
- `scripts/verify-openapi.mjs` curl matrix (live run in the final re-gate): every
  documented path 200/201 incl. idempotent replay, negatives → 401
  UNAUTHENTICATED / INVALID_API_KEY. Final run 7/7 PASS —
  evidence `data/openapi-verify-1788405172219.json` (paths documented =
  payments POST/GET, wallets GET, openapi.json GET).

## Phase 9 — Load/soak evidence

- [x] `scripts/soak/` Node-based profile: concurrent public-API payment creates under mock
      provider + batch chunk + outbox burst; bounded runtime; honest results write-up
      (no benchmark claims).
- [x] Notes on BullMQ retry tuning from observations. (Reviewed after the soak runs:
      zero job failures across all profiles — no retry-policy changes warranted;
      policies in QUEUE_POLICIES stay as tuned in Phase 7.)

### Evidence
- `scripts/soak/run.mjs` — bounded soak runner: configurable concurrency bursts of
  public-API payment creates (idempotency-keyed, mock provider), waits for outbox +
  BullMQ drain via `/api/admin/metrics`, then writes latency percentiles (p50/p95),
  status breakdown and drain state to `data/soak/soak-<ts>.json`. Single-sandbox-node
  numbers are observations, not benchmark claims.
- Live runs + write-up in `data/soak/` (final re-gate):
  `soak-1788405225963.json` (120 req, 10-deep bursts — p50 168ms / p95 310ms),
  `soak-1788405259950.json` (200 req, 20-deep bursts — p50 318ms / p95 527ms),
  `soak-1788405404737.json` (final clean-state 120/10 — p50 153ms / p95 271ms).
  Every profile: **0 rejected, queue waiting 0 + outbox 0 at drain, all payments
  SUCCESS through the mock provider** (380/380 soak payments verified in the DB).
  Honest caveats, not benchmark claims (single sandbox node):
  1. A deliberate first run (`soak-1788405185490.json`) hit the public API's
     documented per-key guard — 60/min fixed window — at request 60 (60×201 then
     429 RATE_LIMITED): the limiter demonstrably enforces its contract. The
     runner therefore round-robins a few keys (per-key limit still applies),
     which is how real tenants hold the API.
  2. E2E-fixture webhook subscriptions (dead 127.0.0.1 receivers left by earlier
     Playwright sessions) caused webhook fan-out retries to fail terminally
     (3078 FAILED + 1 DELIVERED live-path) — Phase-2 bounded-retry behavior
     working as designed. Fixtures were then disabled via the product API
     (`PATCH /api/webhooks/:id` → DISABLED) and the final soak ran on the clean
     state with zero new deliveries.
  3. Latencies are request-side observations on localhost; no production
     capacity claims.

## Phase 10 — External seams (SEAM — requires credentials/certification)

- [x] Recon auto-pull seam (Daraja statement pull endpoint — implement adapter call shape
      + docs; live requires Safaricom cert) — merged into Phase 3/runbook.
- [x] Disputes & chargebacks: design doc + schema proposal (needs product decisions +
      provider windows). NOT blindly implemented.
- [x] Partial refunds & fee handling: design doc (ledger semantics). NOT blindly implemented.
- [x] eTIMS/VAT invoicing + WHT: requirements doc; adapter seam only.
- [x] Payroll statutory (PAYE/NSSF/SHIF) — needs authoritative rates source; doc only.
- [x] Multi-currency: explicitly deferred (architectural; KES-only is a documented launch
      decision unless reversed).

### Evidence
- All Phase 10 deliverables live in `docs/seams/` (design-only, deliberately no code that
  would fake a live integration): `daraja-recon-pull.md`, `disputes-chargebacks.md`,
  `refunds-fees.md`, `etims-vat-wht.md`, `payroll-statutory.md`.

## Standing rules

- No demo/dev defaults ship as production posture.
- Maker-checker rubric from earlier work stays intact (demo@zfloat.app above-threshold
  stays PENDING_APPROVAL until a distinct admin approves; under-threshold single-actor).
- Every code change keeps the full Playwright suite green (final-gate baseline: **34/34 passed**
  — see the Close-out sweep below for the flake-elimination root causes and evidence) and the
  live demo walkthrough working.
- Every finished item updates TODO.md / KNOWN_LIMITATIONS.md / checklists as applicable.

## Close-out sweep — the seven post-review gaps (all closed, with running evidence)

The candid self-review found seven gaps in the delivered phases; each is now closed with
reproducible live evidence (same rules as the rest of the project: no fake live integrations).

1. **Phase 5/7 routes over the wire** — `scripts/verify-admin-ops.mjs` (19/19) exercises admin
   metrics (401 anon / 403 non-admin / 200 Prometheus text with queue + outbox + heartbeat
   series), DSAR export/erasure guardrails and the intake queue live;
   `scripts/verify-dsar-intake.mjs` runs the whole public DSAR journey over HTTP: anonymous
   self-service `POST /api/privacy/requests` (only opens REQUESTED rows — never executes
   anything), anonymous admin-side 401s, admin review (REQUESTED→IN_REVIEW→COMPLETED),
   export bundle, erasure `confirm:"ERASE"` guardrail (422 → data intact → ERASE → identity
   anonymized to `erased-<id>@erased.invalid`, re-export 404) and the self-erasure 403.
   Evidence: `data/admin-api-verify-1788481921325.json`, `data/compliance/dsar-wire-*.json`.
2. **Soak profiles** — chunked batch payouts (`scripts/soak/batch.mjs`, 250 rows → two 200-row
   chunks, 250/250 SUCCESS), signed webhook fan-out to a live 127.0.0.1 receiver
   (`scripts/verify-webhook-fanout.mjs`, HMAC verified 3/3, DB DELIVERED 3/3, 0 FAILED), report
   + notification bursts inside the bounded mixed profile (`scripts/soak/mixed.mjs`:
   payments 60/60, receiver-200 60/60, signatures 60/60, reports 12/12, notifications 40/40,
   0 rejections, full drain). Evidence: `data/soak/soak-*.json`, `data/soak/batch-*.json`,
   `data/soak/mixed-1788480045548.json`, `data/webhooks/fanout-*.json`.
3. **Chaos drills** — worker crash (SIGKILL mid-traffic → 0/40 progressed while dead,
   restart → 40/40 SUCCESS exactly once, 0 dupes, journals balanced; `worker-crash-*.json`),
   Redis outage (`redis-outage-*.json`: payments answered 201 during the outage, login 200,
   static OpenAPI 200, after-outage 201 + exactly-once SUCCESS; after the ledger-record
   self-heal the record is restored ~1 min post-restart — see KNOWN_LIMITATIONS #23), Postgres
   outage (`pg-outage-1788479373443.json`: error paths fast + explicit, worker/relay survive
   the full stop/start cycle). The drills improved live code twice: unowned pg pool `error`
   events crashed worker+relay (now owned in the shared factory), and the bounded-Redis
   hardening initially broke healthy-path health checks (see KNOWN_LIMITATIONS #23).
4. **PITR rehearsal with measured RTO/RPO** — WAL archiving (`archive_mode=on`,
   `wal_level=replica`, archive_command → postgres-owned staging), `pg_basebackup -Fp -X
   stream` base, then a real recovery to a scratch cluster with `recovery_target_time`
   straddled by marker payments: marker A (before T) present, marker B (after T) absent at the
   exact commit cut (recovery stopped before commit 22181 at 2026-09-03 23:50:35.696Z).
   Measured on this sandbox: ~2-3s to a consistent recovered cluster from a local base +
   archive; RPO bounded by WAL archive cadence (~1.7s observed gap on this workload).
   Evidence + writeup: `data/pitr/pitr-drill-summary.json`,
   `docs/architecture/pitr-rehearsal.md`.
5. **Query-performance evidence** — EXPLAIN (ANALYZE, BUFFERS) captured on the hot paths
   (payment list, webhook-delivery list, notifications inbox, audit search, metrics 24h
   aggregates) at `data/performance/explain-20260903-2355.log`; planner correctly seq-scans at
   demo scale (<4 ms everywhere); index paths proven with `enable_seqscan=off`. From the
   evidence, ordering-composite indexes were added where the sort/scan pattern would bite at
   volume: `webhook_deliveries(tenant_id, created_at DESC)`, `webhook_deliveries(created_at)`,
   `notifications(tenant_id, created_at DESC)`, `audit_events(action, created_at DESC)` —
   custom migration `packages/database/custom-migrations/018_perf_indexes.sql`, applied and
   live.
6. **E2E flake elimination** — full root-cause write-up in KNOWN_LIMITATIONS #23. Causes
   fixed (spec-vs-30s-refresh race in health-alerts; bounded-Redis fresh-client race +
   quit-on-shared-client regression; ledger-health Redis record TTL/cadence gaps + flush
   self-heal). Evidence: `data/e2e/final-suite-*.log` (34/34 at `--retries=0`, incl. the
   post-environment-recycle from-scratch re-run `final-suite-20260904-020234-retries0-freshenv.log`)
   and the targeted 9/9 runs with `--retries=0` (health-alerts, developers, system-health ×3 each).
7. **OpenAPI drift guard** — `scripts/verify-openapi.mjs` now walks the route-handler source
   tree (`apps/web/app/api/**/route.ts`) and fails the verification if the public v1 spec and
   the shipped routes disagree in either direction (documented=3, handlers=3, missing=0,
   undocumented=0). The Next routes-manifest only lists dynamic handlers, so the route tree —
   not the manifest — is the source of truth. Evidence: `data/openapi-verify-1788479571781.json`.

Plus: **DSAR subject self-service intake** is the public `POST /api/privacy/requests` route
(rate-limited 5/hr/IP — enforced, see the 429 in `data/compliance/dsar-wire-*.json`); it only
ever opens a REQUESTED row for a platform admin to identity-check and fulfil through
`/api/admin/dsar/*` (proven end to end in the wire drill above).

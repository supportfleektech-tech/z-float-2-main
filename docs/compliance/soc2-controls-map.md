# SOC2 controls map (Z-float)

Mapping of AICPA Trust Services Criteria to Z-float's evidence. Each row:
what the criterion needs → where it lives in the product/repo → the artifact
produced by `pnpm evidence` or the test suite that demonstrates it.

Legend: [E] = runtime evidence artifact · [T] = test/CI evidence · [R] = runbook/config in repo

## CC6 — Logical and physical access control

| Criterion | What it needs | Evidence in Z-float |
|---|---|---|
| CC6.1 | Least-privilege access & segregation of duties | [T] RBAC matrix: `roles`/`permissions`/`user_roles`; maker-checker approval flow (`approvals` pkg: payments, batch payouts, payee-book activation, reversals, privileged role invites, **platform catalog config** via `platform_config` requests + `/admin/approvals` centre, seeded checker `ops@zfloat.app`; policy builder UI + E2E `approvals`/`batch-b`); admin console RBAC E2E (`unauthorized users are blocked from admin`) |
| CC6.2 | User provisioning/de-provisioning | [E] `access-review.csv` (users+roles+MFA, current state); invite flow `invitations` with expiry; deactivation = `users.status` |
| CC6.3 | Access review | [E] `access-review.csv` + `login-events.csv`; quarterly review checklist: RB runbook RB-17 |
| CC6.4 | Restrict physical access | Deployment note: cloud-hosted (per deployment) — VM/container isolation, egress rules; outside code scope |
| CC6.5 | Restrict logical access to network | [R] middleware/auth guards: session cookie `SESSION_SECRET` (≥32 chars, vault-backed C2), MFA (TOTP), login rate limiting (`rateLimit` in `lib/api.ts`), lockout on failed logins |
| CC6.6 | Prevent/mitigate malware | [T] `files.scan` queue → ClamAV driver (`MALWARE_SCANNER_DRIVER=clamav`); E2E compliance spec asserts CLEAN state |
| CC6.7 | Data transmission security | [R] TLS terminated at ingress (deployment); `COOKIE_SECURE` in production config |

## CC7 — System operations

| Criterion | What it needs | Evidence in Z-float |
|---|---|---|
| CC7.1 | Detect anomalies | [E] `security-events.csv` (event types + severity) |
| CC7.2 | Monitor incidents & respond | [E] `login-events.csv` (failures/MFA challenges); system-health page + alert rules (`/admin/health`, E2E `system-health.spec`); RB-08 security incident runbook |
| CC7.3 | Evaluate security events | [R] worker logs + `observability` package alert rules (`packages/observability`) |

## CC8 — Change management

| Criterion | What it needs | Evidence in Z-float |
|---|---|---|
| CC8.1 | Authorized changes, tested & tracked | [E] `integrity-migrations.csv` (migration ledger, applied_at); [T] CI (`pnpm ci:local` = lint+typecheck+unit+integration+web build); [R] RB-07 (webhook replay/destructive ops discipline), RB-06 admin pricing change |
| CC8.2/8.3 | Software design / development | [T] immutability triggers (custom migrations 001/011) prove append-only financial records; journals balance in code + DB trigger; double-spend prevention tests |

## A1 — Availability & business continuity

| Criterion | What it needs | Evidence in Z-float |
|---|---|---|
| A1.1 | Capacity planning | [R] deployment docs; BullMQ queues + outbox relay scale-out (RB-12) |
| A1.2 | Recovery & monitoring | [E] `operations-health.csv` (db connections, outbox backlog, ledger rows); [R] RB-05 restore drill (backup/restore); RB-13 multi-region topology |
| A1.3 | Storage recovery | [R] RB-05; report artifacts retention sweep (migration 010) |

## Additional considerations (SOC2 mapping practice)

- **Logical access hardening summary** (for the control narrative): bcrypt
  password hashes, argon/bcrypt not stored in plaintext; API keys stored as
  SHA-256 hashes only (`api-keys` module); session + encryption secrets
  vault-backed via `@zfloat/secrets` (C2) with KMS envelope encryption in
  production; `ENCRYPTION_KEY` zero-key refused in production config.
- **Financial integrity evidence** beyond SOC2: journal balance triggers,
  wallet non-negative triggers, wallet ledger (C-3) replayable trail,
  reconciliation engine with MATCHED/UNMATCHED exceptions (Tier-1 E2E).

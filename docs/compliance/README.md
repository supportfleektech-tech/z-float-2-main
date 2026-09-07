# Compliance pack (Batch C-4)

SOC2-style evidence collection, penetration-test runbook, and ODPC (Kenya
Data Protection Act 2019) DPA compliance pack for Z-float.

| Artifact | Path | Purpose |
|---|---|---|
| Evidence collector | `scripts/compliance/collect-evidence.ts` | Pulls control evidence from the live DB into `data/compliance/<timestamp>/` with a SHA-256 manifest |
| SOC2 controls map | `docs/compliance/soc2-controls-map.md` | Trust Services Criteria → evidence source mapping |
| ODPC DPA pack | `docs/compliance/odpc-dpa-pack.md` | Records of processing, DPA terms, DSAR procedure, breach notification |
| Pen-test runbook | `docs/compliance/pen-test-runbook.md` | Scoped test plan, prep checklist, reporting template |
| Sample run | `data/compliance/<timestamp>/` | Machine-generated evidence + MANIFEST.json (chain of custody) |

## Quick start

```bash
# Collect a full evidence set from the live database
pnpm evidence                 # alias: tsx scripts/compliance/collect-evidence.ts
pnpm evidence --limit=2000    # raise the per-table cap

# Point at a specific database without touching .env
EVIDENCE_DATABASE_URL=postgresql://… pnpm evidence
```

Outputs land in `data/compliance/<ISO-UTC>/`:

- `audit-events.csv`, `login-events.csv`, `security-events.csv` — audit/access
  evidence (SOC2 CC6.1–CC6.3, CC7.2)
- `access-review.csv` — users, roles, MFA state (CC6.3 access review)
- `consent-records.csv`, `data-requests.csv`, `kyc-scan-status.csv` — ODPC
  records of processing / DSAR / consent evidence
- `operations-health.csv`, `integrity-migrations.csv` — availability (A1.2)
  and config/change management (CC8.1) indicators (catalog config changes now ride the maker-checker `platform_config` approvals + `/admin/approvals` centre)
- `system-inventory.json`, `env-snapshot.json`, `dependency-audit.txt` —
  environment evidence. **Secret values are never written**: env snapshot
  records variable names only (`set` / `UNSET` / truncated sha256 for secrets).
- `MANIFEST.json` — per-artifact SHA-256 for the evidence set (chain of custody)

## Evidence handling notes

- Every artifact is stamped with collector, UTC timestamp and source table.
- `audit_events`, `login_events`, `security_events`, `journal_entries`,
  `wallet_ledger_entries` etc. are **append-only at the DB** (custom
  migrations 001/011) — tamper evidence is structural, not just claimed.
- Export runs are snapshots: keep the run folder immutable (object storage /
  read-only volume) when an audit trail of evidence is required.
- Re-run on a schedule (e.g. weekly cron) to show continuous collection.

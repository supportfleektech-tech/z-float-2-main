#!/usr/bin/env bash
# scripts/restore-drill.sh — automated restore drill (GAP Phase 6, RB-05).
#
# Restores the newest backup into a scratch database (zfloat_restore_drill)
# and VERIFIES row counts of the core tables match the source DB — the drill
# fails loudly on any mismatch. The scratch DB is dropped afterwards; a log is
# kept in data/backups/restore-drill-<ts>.log as evidence.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/data/backups}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
HOST="$(python3 -c "import urllib.parse as u; print(u.urlparse('$DB_URL').hostname)")"
PORT="$(python3 -c "import urllib.parse as u; print(u.urlparse('$DB_URL').port or 5432)")"
DB="$(python3 -c "import urllib.parse as u; print(u.urlparse('$DB_URL').path.lstrip('/'))")"
USER="$(python3 -c "import urllib.parse as u; print(u.unquote(u.urlparse('$DB_URL').username))")"
export PGPASSWORD="$(python3 -c "import urllib.parse as u; print(u.unquote(u.urlparse('$DB_URL').password or ''))")"

DUMP="$(ls -t "$BACKUP_DIR"/zfloat-*.dump | head -1)"
[[ -n "$DUMP" ]] || { echo "no backup found in $BACKUP_DIR" >&2; exit 1; }

TS="$(date +%Y%m%d-%H%M%S)"
SCRATCH="zfloat_restore_drill"
LOG="$BACKUP_DIR/restore-drill-$TS.log"

{
  echo "[drill $(date -Iseconds)] === restore drill started ==="
  echo "[drill] source db: $DB | backup: $DUMP"

  # checksum first — a corrupt backup must fail the drill
  (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$DUMP").sha256")

  start=$(date +%s)
  dropdb -h "$HOST" -p "$PORT" -U "$USER" --if-exists "$SCRATCH"
  createdb -h "$HOST" -p "$PORT" -U "$USER" "$SCRATCH"
  pg_restore -h "$HOST" -p "$PORT" -U "$USER" -d "$SCRATCH" --no-owner --role="$USER" "$DUMP"
  end=$(date +%s)
  echo "[drill] restore took $((end - start))s into $SCRATCH"

  # row-count parity on core tables (financial, identity, audit, ops)
  TABLES="tenants users user_roles sessions payments wallet_ledger_entries audit_events
           security_events recon_exceptions recon_items webhook_deliveries notifications"
  FAIL=0
  for t in $TABLES; do
    SRC="$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc "SELECT count(*) FROM $t")"
    DST="$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$SCRATCH" -tAc "SELECT count(*) FROM $t")"
    printf "%-28s source=%-8s restored=%-8s %s\n" "$t" "$SRC" "$DST" "$([[ "$SRC" == "$DST" ]] && echo OK || echo MISMATCH)"
    [[ "$SRC" == "$DST" ]] || FAIL=1
  done

  # smoke: the restored DB answers and holds the latest migration marker
  SMOKE="$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$SCRATCH" -tAc "SELECT count(*) FROM recon_exception_activity")"
  echo "[drill] smoke query on restored db OK (recon_exception_activity=$SMOKE)"

  dropdb -h "$HOST" -p "$PORT" -U "$USER" "$SCRATCH"
  if [[ "$FAIL" == "0" ]]; then
    echo "[drill $(date -Iseconds)] === SUCCESS: all tables verified, scratch dropped ==="
  else
    echo "[drill $(date -Iseconds)] === FAILURE: mismatched tables (see above) ==="
    exit 1
  fi
} 2>&1 | tee "$LOG"

echo "drill log: $LOG"

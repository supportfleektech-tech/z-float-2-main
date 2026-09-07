#!/usr/bin/env bash
# scripts/backup.sh — nightly PostgreSQL backup + retention (GAP Phase 6).
#
# What it does:
#  1. pg_dump (custom format) of DATABASE_URL's DB into data/backups/
#  2. SHA-256 checksum written next to the dump
#  3. Retention: dumps older than KEEP_DAYS (default 7) are pruned
#
# WAL archiving / PITR guidance (production posture):
#  Nightly full dumps bound worst-case data loss to ~24h. For PITR, enable
#  `wal_level=replica` + `archive_mode=on` + `archive_command` to a durable
#  object store and restore with `pg_restore` of the base + replay of WAL
#  segments (see runbook RB-05). This script is the nightly base layer.
#
# Cron wiring (sandbox demo stack):
#   0 2 * * * /home/user/zfloat/scripts/backup.sh >> /home/user/zfloat/data/backups/backup.log 2>&1
#  `crontab -e` (or /etc/cron.d) — see RB-05.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/data/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

mkdir -p "$BACKUP_DIR"

# Load DATABASE_URL etc. from the repo .env (local dev/demo) unless already set.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/zfloat-$STAMP.dump"
LOG="$BACKUP_DIR/backup.log"

echo "[backup $(date -Iseconds)] starting" | tee -a "$LOG"

# Extract host/port/db/user from the URL (assumes postgres://user:pass@host:port/db)
HOST="$(python3 -c "import sys,urllib.parse as u; print(u.urlparse('$DB_URL').hostname)")"
PORT="$(python3 -c "import sys,urllib.parse as u; print(u.urlparse('$DB_URL').port or 5432)")"
DB="$(python3 -c "import sys,urllib.parse as u; print(u.urlparse('$DB_URL').path.lstrip('/'))")"
USER="$(python3 -c "import sys,urllib.parse as u; print(u.unquote(u.urlparse('$DB_URL').username))")"
export PGPASSWORD="$(python3 -c "import sys,urllib.parse as u; print(u.unquote(u.urlparse('$DB_URL').password or ''))")"

pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -Fc -f "$DUMP"
sha256sum "$DUMP" > "$DUMP.sha256"
SIZE="$(du -h "$DUMP" | cut -f1)"

echo "[backup $(date -Iseconds)] wrote $DUMP ($SIZE)" | tee -a "$LOG"

# Retention
PRUNED=0
while IFS= read -r old; do
  rm -f "$old" "$old.sha256"
  PRUNED=$((PRUNED + 1))
  echo "[backup $(date -Iseconds)] pruned $old" | tee -a "$LOG"
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'zfloat-*.dump' -mtime +"$KEEP_DAYS")

echo "[backup $(date -Iseconds)] done — $PRUNED pruned (keep ${KEEP_DAYS}d)" | tee -a "$LOG"

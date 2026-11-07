#!/usr/bin/env bash
# Secret Rotation Reminder — runs quarterly via cron
# Sends an ops alert reminding the team to rotate secrets per RB-19

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load environment
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  set -a
  source "${PROJECT_ROOT}/.env"
  set +a
fi

OPS_EMAILS="${OPS_ALERT_EMAILS:-ops@example.com}"
ALERT_SUBJECT="[Z-float] Quarterly Secret Rotation Reminder"
ALERT_BODY="
Quarterly secret rotation is due per RB-19.

Please review and rotate the following secret categories:
1. API keys (MPesa, Bank, eTIMS) — 90 days
2. ENCRYPTION_KEY — 180 days
3. SESSION_SECRET — 180 days
4. Database/Redis passwords — 90 days
5. SMTP credentials — 180 days
6. Webhook signing secrets — 90 days

Rotation procedure:
1. Generate new secret: openssl rand -hex 32
2. Update envelope: pnpm secrets set <NAME> \"<VALUE>\" --comment \"Quarterly rotation $(date +%F)\" --driver kms
3. Restart affected services
4. Verify health endpoint and test a sandbox payment

See RB-19 in docs/runbooks.md for full details.

This is an automated reminder. No action is taken by this script.
"

# Send email (requires sendmail or configured MTA)
if command -v sendmail &> /dev/null; then
  echo -e "Subject: ${ALERT_SUBJECT}\nTo: ${OPS_EMAILS}\n\n${ALERT_BODY}" | sendmail -t
  echo "Sent rotation reminder to ${OPS_EMAILS}"
else
  echo "WARNING: sendmail not found. Logging alert instead."
  echo "${ALERT_BODY}" | logger -t zfloat-secret-rotation
fi
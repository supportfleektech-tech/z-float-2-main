#!/usr/bin/env bash
# Credential Audit — runs monthly via cron
# Checks for expired/weak secrets and logs findings

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOG_FILE="/var/log/zfloat/credential-audit.log"
mkdir -p "$(dirname "${LOG_FILE}")"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "${LOG_FILE}"
}

log "=== Credential Audit Started ==="

# Check ENCRYPTION_KEY strength
if [[ -n "${ENCRYPTION_KEY:-}" ]]; then
  if [[ "${ENCRYPTION_KEY}" =~ ^0+$ ]]; then
    log "CRITICAL: ENCRYPTION_KEY is all zeros (dev default)"
  elif [[ ${#ENCRYPTION_KEY} -ne 64 ]]; then
    log "WARNING: ENCRYPTION_KEY length is ${#ENCRYPTION_KEY} (expected 64 hex chars)"
  else
    log "OK: ENCRYPTION_KEY length is 64 hex chars"
  fi
else
  log "WARNING: ENCRYPTION_KEY not set in environment"
fi

# Check SESSION_SECRET strength
if [[ -n "${SESSION_SECRET:-}" ]]; then
  if [[ "${SESSION_SECRET}" == *"dev-only"* ]]; then
    log "WARNING: SESSION_SECRET appears to be dev default"
  elif [[ ${#SESSION_SECRET} -lt 32 ]]; then
    log "WARNING: SESSION_SECRET length is ${#SESSION_SECRET} (recommended 32+)"
  else
    log "OK: SESSION_SECRET length is ${#SESSION_SECRET}"
  fi
else
  log "WARNING: SESSION_SECRET not set in environment"
fi

# Check SECRETS_LOCAL_KEY if using local driver
if [[ "${SECRETS_DRIVER:-}" == "local" ]]; then
  if [[ -n "${SECRETS_LOCAL_KEY:-}" ]]; then
    if [[ ${#SECRETS_LOCAL_KEY} -ne 64 ]]; then
      log "WARNING: SECRETS_LOCAL_KEY length is ${#SECRETS_LOCAL_KEY} (expected 64)"
    else
      log "OK: SECRETS_LOCAL_KEY length is 64 hex chars"
    fi
  else
    log "WARNING: SECRETS_DRIVER=local but SECRETS_LOCAL_KEY not set"
  fi
fi

# Check KMS key ID if using KMS driver
if [[ "${SECRETS_DRIVER:-}" == "kms" ]]; then
  if [[ -n "${SECRETS_KMS_KEY_ID:-}" ]]; then
    log "OK: SECRETS_KMS_KEY_ID is set"
  else
    log "WARNING: SECRETS_DRIVER=kms but SECRETS_KMS_KEY_ID not set"
  fi
fi

# Check provider credentials
for secret in MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET BANK_API_KEY BANK_API_SECRET ETIMS_SANDBOX_SECRET; do
  if [[ -n "${!secret:-}" ]]; then
    log "OK: ${secret} is set"
  else
    log "INFO: ${secret} not set (may be in vault)"
  fi
done

# Check secret vault files
SECRETS_DIR="${SECRETS_DIR:-./data/secrets}"
if [[ -d "${SECRETS_DIR}" ]]; then
  log "Checking secret envelopes in ${SECRETS_DIR}..."
  for file in "${SECRETS_DIR}"/*.json; do
    if [[ -f "${file}" ]]; then
      name=$(basename "${file}" .json)
      if [[ -n "${SECRETS_KMS_KEY_ID:-}" ]]; then
        # KMS envelope - check if it has required fields
        if jq -e '.ciphertext' "${file}" >/dev/null 2>&1; then
          log "OK: KMS envelope for ${name} has ciphertext"
        else
          log "WARNING: KMS envelope for ${name} missing ciphertext"
        fi
      else
        # Local envelope - check if it has required fields
        if jq -e '.ciphertext and .iv and .tag' "${file}" >/dev/null 2>&1; then
          log "OK: Local envelope for ${name} has all fields"
        else
          log "WARNING: Local envelope for ${name} missing fields"
        fi
      fi
    fi
  done
else
  log "INFO: No secret vault directory at ${SECRETS_DIR}"
fi

# Check for expired secrets (if rotation dates tracked)
log "Checking secret rotation dates (if tracked)..."
# This would require a separate tracking mechanism (e.g., a rotation log)

log "=== Credential Audit Completed ==="
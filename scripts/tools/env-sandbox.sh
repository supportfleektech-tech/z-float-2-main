#!/bin/bash
# Canonical sandbox/demo build+run env — copy to /tmp/zf-build-env.sh (or source directly).
# Postgres+Redis must be up; worker/relay/clamd-stub run separately (runbook RB-02b).
# Prod-class build/run env for the sandbox demo stack (recreated after wipes).
set -a
. /home/user/zfloat/.env
set +a
export NODE_ENV=production
export DEMO_MODE=true
export SEED_DEMO_DATA=false
export MALWARE_SCANNER_DRIVER=clamav
export AUTH_LOGIN_RATE_MAX=1000

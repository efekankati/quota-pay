#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Quota Pay — One-Command Ephemeral AWS Spot Deployment (infra/scripts/up.sh)
# Provisions the eu-south-1 EC2 Spot instance (~$0.005/hr) and starts the
# FinOps CostGuard background circuit breaker.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
  set +a
fi

export AWS_PROFILE="${AWS_PROFILE:-efekankati}"
echo "🚀 [Quota Pay] Deploying AWS eu-south-1 (Milan) EC2 Spot Instance (Profile: ${AWS_PROFILE})..."
python3 "${SCRIPT_DIR}/terraform_actuator.py" deploy "$@"

echo "🛡️ [Quota Pay] Starting FinOps CostGuard background monitor..."
nohup python3 "${SCRIPT_DIR}/cost_guard.py" "$@" > "${ROOT_DIR}/cost_guard.log" 2>&1 &
echo "✅ CostGuard active (PID: $!, logs: ${ROOT_DIR}/cost_guard.log)"


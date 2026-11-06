#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Quota Pay — One-Command Emergency Infrastructure Teardown (infra/scripts/destroy.sh)
# Destroys all billable AWS resources in eu-south-1 down to $0.00/hr.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
  set +a
fi

REASON="${1:-Manual operator destroy}"
echo "🛑 [Quota Pay] Tearing down AWS eu-south-1 Spot infrastructure (${REASON})..."
python3 "${SCRIPT_DIR}/terraform_actuator.py" destroy "${REASON}"
echo "✅ [Quota Pay] Infrastructure destroyed. AWS compute spend is now $0.00/hr."

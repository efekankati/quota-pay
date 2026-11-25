#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MAX_HEADLESS_GUESTS=9
MAX_VISIBLE_GUESTS=3

SCENARIO=""
BILL_MODE=""
RECEIPT_IMAGE=""
HAS_RECEIPT_IMAGE=0

GUESTS=""
MODE_SET=""
HEADLESS_GUESTS=""
SEED=""
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
KEEP_ALIVE_ON_FAIL=0
ENABLE_UI=0
UI_PORT=""
UI_KEEP_OPEN=0
NO_TUI=0
JSON_MODE=0
GUEST_RAM_MB=""
BOOT_BATCH_SIZE=""
PREPARE_SNAPSHOTS=0
NO_SNAPSHOT=0
KEEP_ALIVE=0
REUSE_RUNNING=0
GUEST_GPU=""

print_usage() {
  cat <<'EOF'
Usage:
  scripts/run_android_e2e.sh --scenario <4-visible|10-headless> [--analyze-receipt [IMAGE] | --manual] [options]
  scripts/run_android_e2e.sh --guests <N> [--headless-guests | --show-all-windows] [--analyze-receipt [IMAGE] | --manual] [options]

Device Topologies (--scenario):
  --scenario 4-visible    1 Organizer + 3 Guests — all 4 emulator windows visible (default images)
  --scenario 10-headless  1 Organizer (visible) + 9 Guests (headless AOSP ATD, -no-window)

Bill Creation Modes (mutually exclusive):
  --analyze-receipt [PATH]  Auto-ensure AI proxy, push receipt image to emulator-5554 gallery,
                            pick image via Photo Picker, parse with Gemini Vision, & split
                            (omit PATH to auto-select e2e/fixtures/receipt_4p.jpg or receipt_10p.jpg)
  --manual                  Create a fresh timestamped manual bill on Phone 1 without AI proxy

Legacy Guest Limits (when --scenario is omitted):
  -g, --guests <N>        Number of guests (1-9 with --headless-guests, 1-3 with --show-all-windows)
      --headless-guests   Run guests headless with Organizer window visible (default)
      --show-all-windows  Show all emulator windows (alias: --all-windows; 1-3 guests)

Options:
      --guest-ram-mb <MB> Guest RAM override in MB (512-4096; default: 1024 for all guests)
      --boot-batch-size <N> Concurrent emulators to boot per batch (1-10; default: 2)
      --prepare-snapshots Boot AVDs, install APK cleanly, save 'clean_ready' snapshots, and exit
      --no-snapshot       Bypass 'clean_ready' snapshots and force cold boot
      --keep-alive        Keep booted emulators alive after E2E completion for warm reuse
      --reuse-running     Skip booting already-ready AVDs and reset app via 'pm clear'
      --guest-gpu <MODE>  Headless guest GPU mode: auto | swiftshader_indirect | off
      --seed <INT>        Deterministic random seed passed to the E2E runner
      --apk <PATH>        APK path (default: android/app/build/outputs/apk/debug/app-debug.apk)
      --keep-alive-on-fail Keep emulators running if E2E fails
      --ui                Start lightweight local SSE live browser dashboard (http://127.0.0.1:8765)
      --ui-port <PORT>    TCP port for --ui live dashboard (1-65535; default: 8765)
      --ui-keep-open      Keep --ui live dashboard open after run completes until Ctrl+C
      --no-tui            Disable Rich live board and print timestamped plain-text steps
      --json              Emit final structured summary JSON to stdout
  -h, --help              Show this help and exit

Examples:
  scripts/run_android_e2e.sh --scenario 4-visible --analyze-receipt
  scripts/run_android_e2e.sh --scenario 4-visible --analyze-receipt path/to/receipt.jpg
  scripts/run_android_e2e.sh --scenario 4-visible --manual
  scripts/run_android_e2e.sh --scenario 10-headless --analyze-receipt
  scripts/run_android_e2e.sh --scenario 10-headless --manual
EOF
}

reject_input() {
  local reason="$1"
  {
    echo "ERROR: ${reason}"
    echo ""
    echo "Accepted topologies & bill-creation modes:"
    echo "  - --scenario 4-visible [--analyze-receipt [IMAGE] | --manual]"
    echo "  - --scenario 10-headless [--analyze-receipt [IMAGE] | --manual]"
    echo "  - Legacy: --guests <1..9> --headless-guests  OR  --guests <1..3> --show-all-windows"
    echo "Input rejected without launching any emulator."
  } >&2
  exit 2
}

require_value() {
  local flag="$1"
  local remaining="$2"
  if [[ "${remaining}" -lt 2 ]]; then
    reject_input "Flag '${flag}' requires a value."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      print_usage
      exit 0
      ;;
    --scenario)
      require_value "$1" "$#"
      SCENARIO="$2"
      case "${SCENARIO}" in
        4-visible|10-headless) ;;
        *) reject_input "Flag '--scenario' must be '4-visible' or '10-headless', got '${SCENARIO}'." ;;
      esac
      shift 2
      ;;
    --scenario=*)
      SCENARIO="${1#*=}"
      case "${SCENARIO}" in
        4-visible|10-headless) ;;
        *) reject_input "Flag '--scenario' must be '4-visible' or '10-headless', got '${SCENARIO}'." ;;
      esac
      shift
      ;;
    --analyze-receipt)
      if [[ "${BILL_MODE}" == "manual" ]]; then
        reject_input "Cannot combine --analyze-receipt and --manual (mutually exclusive)."
      fi
      BILL_MODE="analyze-receipt"
      if [[ $# -ge 2 && "$2" != -* ]]; then
        RECEIPT_IMAGE="$2"
        HAS_RECEIPT_IMAGE=1
        shift 2
      else
        shift
      fi
      ;;
    --analyze-receipt=*)
      if [[ "${BILL_MODE}" == "manual" ]]; then
        reject_input "Cannot combine --analyze-receipt and --manual (mutually exclusive)."
      fi
      BILL_MODE="analyze-receipt"
      val="${1#*=}"
      if [[ -n "${val}" ]]; then
        RECEIPT_IMAGE="${val}"
        HAS_RECEIPT_IMAGE=1
      fi
      shift
      ;;
    --manual)
      if [[ "${BILL_MODE}" == "analyze-receipt" ]]; then
        reject_input "Cannot combine --analyze-receipt and --manual (mutually exclusive)."
      fi
      BILL_MODE="manual"
      shift
      ;;
    -g|--guests)
      require_value "$1" "$#"
      if [[ -n "${GUESTS}" ]]; then
        reject_input "Duplicate guest count provided ('$GUESTS' and '$2')."
      fi
      GUESTS="$2"
      shift 2
      ;;
    --guests=*)
      val="${1#*=}"
      if [[ -z "${val}" ]]; then
        reject_input "Flag '--guests=' requires a value."
      fi
      if [[ -n "${GUESTS}" ]]; then
        reject_input "Duplicate guest count provided ('$GUESTS' and '${val}')."
      fi
      GUESTS="${val}"
      shift
      ;;
    --headless-guests)
      if [[ "${MODE_SET}" == "visible" ]]; then
        reject_input "Cannot combine --headless-guests and --show-all-windows."
      fi
      MODE_SET="headless"
      HEADLESS_GUESTS=1
      shift
      ;;
    --show-all-windows|--all-windows)
      if [[ "${MODE_SET}" == "headless" ]]; then
        reject_input "Cannot combine --headless-guests and --show-all-windows."
      fi
      MODE_SET="visible"
      HEADLESS_GUESTS=0
      shift
      ;;
    --seed)
      require_value "$1" "$#"
      SEED="$2"
      if ! [[ "${SEED}" =~ ^-?[0-9]+$ ]]; then
        reject_input "Flag '--seed' must be an integer, got '${SEED}'."
      fi
      shift 2
      ;;
    --apk)
      require_value "$1" "$#"
      APK_PATH="$2"
      if [[ -z "${APK_PATH}" ]]; then
        reject_input "Flag '--apk' requires a non-empty path."
      fi
      shift 2
      ;;
    --keep-alive-on-fail)
      KEEP_ALIVE_ON_FAIL=1
      shift
      ;;
    --ui)
      ENABLE_UI=1
      shift
      ;;
    --ui-port)
      require_value "$1" "$#"
      UI_PORT="$2"
      if ! [[ "${UI_PORT}" =~ ^[0-9]+$ ]] || [[ "$((10#${UI_PORT}))" -lt 1 || "$((10#${UI_PORT}))" -gt 65535 ]]; then
        reject_input "Flag '--ui-port' must be an integer between 1 and 65535, got '${UI_PORT}'."
      fi
      shift 2
      ;;
    --ui-port=*)
      UI_PORT="${1#*=}"
      if [[ -z "${UI_PORT}" ]] || ! [[ "${UI_PORT}" =~ ^[0-9]+$ ]] || [[ "$((10#${UI_PORT}))" -lt 1 || "$((10#${UI_PORT}))" -gt 65535 ]]; then
        reject_input "Flag '--ui-port' must be an integer between 1 and 65535, got '${UI_PORT}'."
      fi
      shift
      ;;
    --ui-keep-open)
      UI_KEEP_OPEN=1
      ENABLE_UI=1
      shift
      ;;
    --no-tui)
      NO_TUI=1
      shift
      ;;
    --json)
      JSON_MODE=1
      shift
      ;;
    --guest-ram-mb)
      require_value "$1" "$#"
      GUEST_RAM_MB="$2"
      if ! [[ "${GUEST_RAM_MB}" =~ ^[0-9]+$ ]] || [[ "$((10#${GUEST_RAM_MB}))" -lt 512 || "$((10#${GUEST_RAM_MB}))" -gt 4096 ]]; then
        reject_input "Flag '--guest-ram-mb' must be an integer between 512 and 4096, got '${GUEST_RAM_MB}'."
      fi
      shift 2
      ;;
    --guest-ram-mb=*)
      GUEST_RAM_MB="${1#*=}"
      if [[ -z "${GUEST_RAM_MB}" ]] || ! [[ "${GUEST_RAM_MB}" =~ ^[0-9]+$ ]] || [[ "$((10#${GUEST_RAM_MB}))" -lt 512 || "$((10#${GUEST_RAM_MB}))" -gt 4096 ]]; then
        reject_input "Flag '--guest-ram-mb' must be an integer between 512 and 4096, got '${GUEST_RAM_MB}'."
      fi
      shift
      ;;
    --boot-batch-size)
      require_value "$1" "$#"
      BOOT_BATCH_SIZE="$2"
      if ! [[ "${BOOT_BATCH_SIZE}" =~ ^[0-9]+$ ]] || [[ "$((10#${BOOT_BATCH_SIZE}))" -lt 1 || "$((10#${BOOT_BATCH_SIZE}))" -gt 10 ]]; then
        reject_input "Flag '--boot-batch-size' must be an integer between 1 and 10, got '${BOOT_BATCH_SIZE}'."
      fi
      shift 2
      ;;
    --boot-batch-size=*)
      BOOT_BATCH_SIZE="${1#*=}"
      if [[ -z "${BOOT_BATCH_SIZE}" ]] || ! [[ "${BOOT_BATCH_SIZE}" =~ ^[0-9]+$ ]] || [[ "$((10#${BOOT_BATCH_SIZE}))" -lt 1 || "$((10#${BOOT_BATCH_SIZE}))" -gt 10 ]]; then
        reject_input "Flag '--boot-batch-size' must be an integer between 1 and 10, got '${BOOT_BATCH_SIZE}'."
      fi
      shift
      ;;
    --prepare-snapshots)
      PREPARE_SNAPSHOTS=1
      shift
      ;;
    --no-snapshot)
      NO_SNAPSHOT=1
      shift
      ;;
    --keep-alive)
      KEEP_ALIVE=1
      shift
      ;;
    --reuse-running)
      REUSE_RUNNING=1
      shift
      ;;
    --guest-gpu)
      require_value "$1" "$#"
      GUEST_GPU="$2"
      case "${GUEST_GPU}" in
        auto|swiftshader_indirect|off) ;;
        *) reject_input "Flag '--guest-gpu' must be auto, swiftshader_indirect, or off, got '${GUEST_GPU}'." ;;
      esac
      shift 2
      ;;
    --guest-gpu=*)
      GUEST_GPU="${1#*=}"
      case "${GUEST_GPU}" in
        auto|swiftshader_indirect|off) ;;
        *) reject_input "Flag '--guest-gpu' must be auto, swiftshader_indirect, or off, got '${GUEST_GPU}'." ;;
      esac
      shift
      ;;
    -*)
      reject_input "Unknown option '$1'. Run with --help for usage."
      ;;
    *)
      if [[ -n "${GUESTS}" ]]; then
        reject_input "Unexpected extra positional argument '$1' (guest count already set to '${GUESTS}')."
      fi
      GUESTS="$1"
      shift
      ;;
  esac
done

PY_TOPOLOGY_ARGS=()
if [[ -n "${SCENARIO}" ]]; then
  if [[ "${SCENARIO}" == "4-visible" ]]; then
    EXP_GUESTS=3
    EXP_HEADLESS=0
    MODE_DESC="scenario 4-visible (1 Organizer + 3 visible guests)"
  else
    EXP_GUESTS=9
    EXP_HEADLESS=1
    MODE_DESC="scenario 10-headless (1 Organizer visible + 9 headless ATD guests)"
  fi
  if [[ -n "${GUESTS}" ]]; then
    if ! [[ "${GUESTS}" =~ ^[0-9]+$ ]] || [[ "$((10#${GUESTS}))" -ne "${EXP_GUESTS}" ]]; then
      reject_input "Cannot combine --scenario ${SCENARIO} with --guests '${GUESTS}' (expected ${EXP_GUESTS})."
    fi
  fi
  if [[ -n "${HEADLESS_GUESTS}" && "${HEADLESS_GUESTS}" -ne "${EXP_HEADLESS}" ]]; then
    reject_input "Cannot combine --scenario ${SCENARIO} with conflicting window flag."
  fi
  GUESTS_INT="${EXP_GUESTS}"
  PY_TOPOLOGY_ARGS+=(--scenario "${SCENARIO}")
else
  if [[ -z "${GUESTS}" ]]; then
    reject_input "Provide either --scenario <4-visible|10-headless> or -g / --guests <N>."
  fi
  if ! [[ "${GUESTS}" =~ ^[0-9]+$ ]]; then
    reject_input "Guest count '${GUESTS}' is not a valid positive integer."
  fi
  GUESTS_INT=$((10#${GUESTS}))
  if [[ "${GUESTS_INT}" -lt 1 ]]; then
    reject_input "Guest count must be at least 1 (got '${GUESTS}')."
  fi
  EFF_HEADLESS="${HEADLESS_GUESTS:-1}"
  if [[ "${EFF_HEADLESS}" -eq 1 ]]; then
    if [[ "${GUESTS_INT}" -gt "${MAX_HEADLESS_GUESTS}" ]]; then
      reject_input "Guest count ${GUESTS_INT} exceeds maximum ${MAX_HEADLESS_GUESTS} allowed with --headless-guests."
    fi
    MODE_FLAG="--headless-guests"
    MODE_DESC="headless guests (Organizer visible + ${GUESTS_INT} headless guest(s))"
  else
    if [[ "${GUESTS_INT}" -gt "${MAX_VISIBLE_GUESTS}" ]]; then
      reject_input "Guest count ${GUESTS_INT} exceeds maximum ${MAX_VISIBLE_GUESTS} allowed with --show-all-windows."
    fi
    MODE_FLAG="--show-all-windows"
    MODE_DESC="all windows shown ($((1 + GUESTS_INT)) visible emulator window(s))"
  fi
  PY_TOPOLOGY_ARGS+=(--guests "${GUESTS_INT}" "${MODE_FLAG}")
fi

BILL_MODE_EFF="${BILL_MODE:-manual}"
if [[ "${BILL_MODE_EFF}" == "analyze-receipt" && "${HAS_RECEIPT_IMAGE}" -eq 1 ]]; then
  RESOLVED_IMG="${RECEIPT_IMAGE}"
  if [[ "${RESOLVED_IMG}" != /* && ! "${RESOLVED_IMG}" =~ ^[A-Za-z]: ]]; then
    if [[ -f "$(pwd)/${RESOLVED_IMG}" ]]; then
      RESOLVED_IMG="$(pwd)/${RESOLVED_IMG}"
    else
      RESOLVED_IMG="${REPO_ROOT}/${RESOLVED_IMG}"
    fi
  fi
  if [[ ! -f "${RESOLVED_IMG}" ]]; then
    reject_input "Receipt image not found: '${RECEIPT_IMAGE}'. Place fixtures under e2e/fixtures/ or omit the path for auto-selection."
  fi
  RECEIPT_IMAGE="${RESOLVED_IMG}"
fi

RESOLVED_APK="${APK_PATH}"
if [[ "${RESOLVED_APK}" != /* && ! "${RESOLVED_APK}" =~ ^[A-Za-z]: ]]; then
  RESOLVED_APK="${REPO_ROOT}/${RESOLVED_APK}"
fi
if [[ ! -f "${RESOLVED_APK}" ]]; then
  echo "ERROR: Debug APK not found at '${RESOLVED_APK}'." >&2
  exit 1
fi

PYTHON_CMD=()
if command -v python >/dev/null 2>&1; then
  PYTHON_CMD=(python)
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD=(python3)
elif command -v py >/dev/null 2>&1; then
  PYTHON_CMD=(py -3)
else
  echo "ERROR: Python executable not found on PATH." >&2
  exit 1
fi

PY_ARGS=(
  "${REPO_ROOT}/e2e/five_phone_android_e2e.py"
  "${PY_TOPOLOGY_ARGS[@]}"
  --apk "${RESOLVED_APK}"
)

if [[ "${BILL_MODE}" == "analyze-receipt" ]]; then
  if [[ "${HAS_RECEIPT_IMAGE}" -eq 1 ]]; then
    PY_ARGS+=(--analyze-receipt "${RECEIPT_IMAGE}")
  else
    PY_ARGS+=(--analyze-receipt)
  fi
elif [[ "${BILL_MODE}" == "manual" ]]; then
  PY_ARGS+=(--manual)
fi

if [[ -n "${SEED}" ]]; then
  PY_ARGS+=(--seed "${SEED}")
fi
if [[ "${KEEP_ALIVE_ON_FAIL}" -eq 1 ]]; then
  PY_ARGS+=(--keep-alive-on-fail)
fi
if [[ "${ENABLE_UI}" -eq 1 ]]; then
  PY_ARGS+=(--ui)
fi
if [[ -n "${UI_PORT}" ]]; then
  PY_ARGS+=(--ui-port "$((10#${UI_PORT}))")
fi
if [[ "${UI_KEEP_OPEN}" -eq 1 ]]; then
  PY_ARGS+=(--ui-keep-open)
fi
if [[ "${NO_TUI}" -eq 1 ]]; then
  PY_ARGS+=(--no-tui)
fi
if [[ "${JSON_MODE}" -eq 1 ]]; then
  PY_ARGS+=(--json)
fi
if [[ -n "${GUEST_RAM_MB}" ]]; then
  PY_ARGS+=(--guest-ram-mb "$((10#${GUEST_RAM_MB}))")
fi
if [[ -n "${BOOT_BATCH_SIZE}" ]]; then
  PY_ARGS+=(--boot-batch-size "$((10#${BOOT_BATCH_SIZE}))")
fi
if [[ "${PREPARE_SNAPSHOTS}" -eq 1 ]]; then
  PY_ARGS+=(--prepare-snapshots)
fi
if [[ "${NO_SNAPSHOT}" -eq 1 ]]; then
  PY_ARGS+=(--no-snapshot)
fi
if [[ "${KEEP_ALIVE}" -eq 1 ]]; then
  PY_ARGS+=(--keep-alive)
fi
if [[ "${REUSE_RUNNING}" -eq 1 ]]; then
  PY_ARGS+=(--reuse-running)
fi
if [[ -n "${GUEST_GPU}" ]]; then
  PY_ARGS+=(--guest-gpu "${GUEST_GPU}")
fi

if [[ "${JSON_MODE}" -eq 0 ]]; then
  echo "[run_android_e2e] Starting E2E run: 1 Organizer + ${GUESTS_INT} Guest(s) | ${MODE_DESC} | Bill mode: ${BILL_MODE_EFF}"
  echo "[run_android_e2e] APK: ${RESOLVED_APK}"
fi

cd "${REPO_ROOT}"
exec "${PYTHON_CMD[@]}" "${PY_ARGS[@]}"

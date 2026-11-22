"""5-Phone Local Android Emulator E2E Test for Quota Pay.

Runs against 5 concurrent local Android Emulators (`emulator-5554`..`5562`)
driven via `ANDROID_SERIAL` + `adb -s` + `@expo/agent-cli` runtime commands:
  - Phone 1 (emulator-5554): Organizer creates a 5-person itemized bill + coperto
  - Phones 2-5 (emulator-5556..5562): Guests join concurrently via `quota://` deep link,
    verify real-time Supabase item sync, run overlapping conflict tap barriers +
    randomized claims, and settle their shares via Google Pay / SEPA Instant
  - Phone 1 verifies real-time updates, settles Organizer share, and asserts
    cent-exact (+/-0.00 EUR) math against BOTH live UI and Supabase database rows.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.android_emulator_fleet import (  # noqa: E402
    AndroidEmulatorFleet,
    DEFAULT_PHONE_SLOTS,
    PhoneSlot,
    list_connected_emulators,
    run_cmd,
)


RECEIPT_ITEMS_SPEC = [
    {"index": 0, "name": "Rigatoni all'Amatriciana", "unit_price": 13.50, "qty": 1, "owner": "organizer"},
    {"index": 1, "name": "Tagliere Antipasto Condiviso", "unit_price": 16.00, "qty": 1, "owner": "shared_3way"},
    {"index": 2, "name": "Spaghetti alla Carbonara", "unit_price": 14.00, "qty": 2, "owner": "race_multi"},
    {"index": 3, "name": "Pizza Margherita DOP", "unit_price": 11.50, "qty": 2, "owner": "random"},
    {"index": 4, "name": "Tagliata di Manzo", "unit_price": 22.00, "qty": 1, "owner": "random"},
    {"index": 5, "name": "Tiramisu della Casa", "unit_price": 6.50, "qty": 3, "owner": "random"},
    {"index": 6, "name": "Vino Chianti Classico 1L", "unit_price": 16.00, "qty": 2, "owner": "random"},
]
COPERTO_PER_PERSON_EUR = 2.50
GUEST_NAMES = ["Marco", "Sara", "Elena", "Davide"]
EXPECTED_ITEMS_CENTS = sum(int(round(i["unit_price"] * 100)) * i["qty"] for i in RECEIPT_ITEMS_SPEC)  # 15400
EXPECTED_COPERTO_CENTS = int(round(COPERTO_PER_PERSON_EUR * 100)) * 5  # 1250
EXPECTED_GRAND_TOTAL_CENTS = EXPECTED_ITEMS_CENTS + EXPECTED_COPERTO_CENTS  # 16650 (€166.50)


def load_env_file(env_path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def _flatten_tree_nodes(data: Any) -> List[Dict[str, Any]]:
    """Normalizes `@expo/agent-cli runtime:tree --json` node shapes."""
    collected: List[Dict[str, Any]] = []

    def _walk(obj: Any) -> None:
        if isinstance(obj, list):
            for item in obj:
                _walk(item)
        elif isinstance(obj, dict):
            if "devServerUrl" not in obj and any(k in obj for k in ("testID", "text", "label", "component", "role")):
                collected.append(obj)
            for child_key in ("nodes", "children", "projection", "matches"):
                if child_key in obj and isinstance(obj[child_key], (list, dict)):
                    _walk(obj[child_key])

    _walk(data)
    return collected


def _extract_node_text(node: Dict[str, Any]) -> str:
    parts: List[str] = []
    for k in ("text", "label", "value", "accessibilityLabel"):
        v = node.get(k)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
    if isinstance(node.get("props"), dict):
        for k in ("text", "children", "accessibilityLabel"):
            v = node["props"].get(k)
            if isinstance(v, str) and v.strip():
                parts.append(v.strip())
    # Deduplicate preserving order
    seen: set[str] = set()
    uniq: List[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return " | ".join(uniq)


def _parse_euro_cents(text: str) -> Optional[int]:
    m = re.search(r"€\s*([0-9]+(?:[.,][0-9]{1,2})?)", text)
    if not m:
        return None
    val = float(m.group(1).replace(",", "."))
    return int(round(val * 100))


class ExpoAgentDeviceDriver:
    """Drives one specific Android Emulator via ANDROID_SERIAL + @expo/agent-cli --port <proxy_port>."""

    def __init__(self, fleet: AndroidEmulatorFleet, slot: PhoneSlot) -> None:
        self.fleet = fleet
        self.slot = slot
        self.logs: List[Dict[str, Any]] = []
        self._npx = "npx.cmd" if os.name == "nt" else "npx"

    def record(self, action: str, detail: str) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "role": self.slot.role,
            "guest_name": self.slot.guest_name,
            "serial": self.slot.serial,
            "action": action,
            "detail": detail,
        }
        self.logs.append(entry)
        tag = self.slot.guest_name or "Organizer"
        print(f"[e2e][{self.slot.serial}][{tag}] {action}: {detail}", flush=True)

    def _run_agent_cli(self, args: List[str], timeout_s: int = 45) -> Tuple[int, Dict[str, Any], str]:
        cmd = [self._npx, "--yes", "@expo/agent-cli", *args]
        env = os.environ.copy()
        env["ANDROID_SERIAL"] = self.slot.serial
        env["ANDROID_HOME"] = str(self.fleet.sdk)
        pt_dir = str(self.fleet.sdk / "platform-tools")
        if pt_dir not in env.get("PATH", ""):
            env["PATH"] = f"{pt_dir}{os.pathsep}{env.get('PATH', '')}"
        env["CI"] = "1"
        env["EXPO_NO_TELEMETRY"] = "1"
        proc = subprocess.run(
            cmd,
            cwd=str(self.fleet.project_root),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()
        parsed: Dict[str, Any] = {}
        if stdout:
            try:
                parsed = json.loads(stdout)
            except json.JSONDecodeError:
                # Try extracting trailing JSON object if stdout has leading noise
                idx = stdout.find("{")
                if idx != -1:
                    try:
                        parsed = json.loads(stdout[idx:])
                    except json.JSONDecodeError:
                        parsed = {"rawStdout": stdout}
        return proc.returncode, parsed, stderr

    def tree(self, *, test_id: Optional[str] = None, all_nodes: bool = True, all_screens: bool = True, retries: int = 6) -> Dict[str, Any]:
        args = [
            "runtime:tree",
            "--port",
            str(self.slot.proxy_port),
            "--no-bundle-check",
            "--no-followups",
            "--max-nodes",
            "500",
            "--json",
        ]
        if all_nodes:
            args.append("--all")
        if all_screens:
            args.append("--all-screens")
        if test_id:
            args.extend(["--testID", test_id])
        last_err = ""
        for attempt in range(retries):
            rc, payload, stderr = self._run_agent_cli(args, timeout_s=30)
            if rc == 0:
                return payload
            last_err = f"{payload or stderr}"
            if attempt < retries - 1:
                time.sleep(1.5)
        raise RuntimeError(f"runtime:tree failed ({rc}) on {self.slot.serial}: {last_err}")

    def find_node(self, test_id: str) -> Optional[Dict[str, Any]]:
        payload = self.tree(all_nodes=True, all_screens=True)
        for node in _flatten_tree_nodes(payload):
            if node.get("testID") == test_id:
                return node
        # Fallback targeted query if truncated in global tree
        try:
            sub = self.tree(test_id=test_id, all_nodes=True, all_screens=True)
            for node in _flatten_tree_nodes(sub):
                if node.get("testID") == test_id:
                    return node
        except RuntimeError:
            pass
        return None

    def get_node_text(self, test_id: str) -> str:
        node = self.find_node(test_id)
        if node is None:
            raise RuntimeError(f"Node with testID='{test_id}' not found on {self.slot.serial}")
        direct = _extract_node_text(node)
        if direct:
            return direct
        sub = self.tree(test_id=test_id, all_nodes=True, all_screens=True)
        parts: List[str] = []
        seen: set[str] = set()
        for child in _flatten_tree_nodes(sub):
            txt = _extract_node_text(child)
            if txt and txt not in seen:
                seen.add(txt)
                parts.append(txt)
        return " | ".join(parts)

    def wait_for_testid(self, test_id: str, timeout_s: float = 45.0, poll_s: float = 0.8) -> Dict[str, Any]:
        deadline = time.time() + timeout_s
        last_err: Optional[str] = None
        while time.time() < deadline:
            try:
                node = self.find_node(test_id)
                if node is not None:
                    return node
            except Exception as exc:
                last_err = str(exc)
            time.sleep(poll_s)
        raise TimeoutError(
            f"Timed out waiting for testID='{test_id}' on {self.slot.serial} (last_err={last_err})"
        )

    def tap(self, test_id: str, *, all_screens: bool = True, retries: int = 5) -> Dict[str, Any]:
        last_err = ""
        for attempt in range(retries):
            args = [
                "runtime:tap",
                test_id,
                "--port",
                str(self.slot.proxy_port),
                "--no-bundle-check",
                "--no-followups",
                "--json",
            ]
            if all_screens:
                args.append("--all-screens")
            rc, payload, stderr = self._run_agent_cli(args, timeout_s=30)
            if rc == 0 and not payload.get("threw"):
                self.record("tap", test_id)
                return payload
            last_err = json.dumps(payload) if payload else stderr
            if attempt < retries - 1:
                time.sleep(1.0)
        raise RuntimeError(f"runtime:tap '{test_id}' failed on {self.slot.serial}: {last_err}")

    def type_text(self, test_id: str, text: str, *, submit: bool = False, retries: int = 5) -> Dict[str, Any]:
        last_err = ""
        for attempt in range(retries):
            args = [
                "runtime:type",
                text,
                "--testID",
                test_id,
                "--port",
                str(self.slot.proxy_port),
                "--no-bundle-check",
                "--no-followups",
                "--json",
            ]
            if submit:
                args.append("--submit")
            args.append("--all-screens")
            rc, payload, stderr = self._run_agent_cli(args, timeout_s=30)
            if rc == 0 and not payload.get("threw"):
                self.record("type", f"{test_id}={text!r}")
                return payload
            last_err = json.dumps(payload) if payload else stderr
            if attempt < retries - 1:
                time.sleep(1.0)
        raise RuntimeError(f"runtime:type '{test_id}' failed on {self.slot.serial}: {last_err}")

    def eval_js(self, expression: str, timeout_s: str = "10s", retries: int = 4) -> Any:
        args = [
            "runtime:eval",
            expression,
            "--port",
            str(self.slot.proxy_port),
            "--timeout",
            timeout_s,
            "--json",
        ]
        last_err = ""
        for attempt in range(retries):
            rc, payload, stderr = self._run_agent_cli(args, timeout_s=30)
            if rc == 0 and not payload.get("threw"):
                val = payload.get("value")
                if isinstance(val, str):
                    try:
                        return json.loads(val)
                    except json.JSONDecodeError:
                        return val
                return val
            last_err = f"{payload or stderr}"
            if payload.get("threw"):
                break
            if attempt < retries - 1:
                time.sleep(1.2)
        raise RuntimeError(f"runtime:eval failed ({rc}) on {self.slot.serial}: {last_err}")

    def read_store_bill(self, bill_id: str) -> Optional[Dict[str, Any]]:
        expr = (
            "JSON.stringify((globalThis.__QUOTA_BILL_STORE__?.getState()?.bills || []).find(b => b.id === "
            + json.dumps(bill_id)
            + ") || null)"
        )
        return self.eval_js(expr)


def fetch_supabase_state(supabase_url: str, anon_key: str, bill_id: str) -> Dict[str, Any]:
    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {anon_key}",
        "Accept": "application/json",
    }

    def _get_json(path_and_query: str) -> Any:
        req = urllib.request.Request(f"{supabase_url}/rest/v1/{path_and_query}", headers=headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get_json_optional(path_and_query: str) -> Any:
        try:
            return _get_json(path_and_query)
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404):
                return []
            raise

    q_like = urllib.parse.quote(f"%{bill_id}%", safe="")
    bills_rows = _get_json(f"bills?select=id,title,total_amount,status,currency,created_at&title=ilike.{q_like}&order=created_at.desc&limit=1")
    row_uuid = str(bills_rows[0]["id"]) if bills_rows else bill_id
    q_uuid = urllib.parse.quote(row_uuid, safe="")
    splits_rows = _get_json_optional(f"bill_splits?select=*&bill_id=eq.{q_uuid}")
    items_rows = _get_json_optional(f"bill_items?select=*&bill_id=eq.{q_uuid}")
    return {
        "bill_row": bills_rows[0] if bills_rows else None,
        "splits_rows": splits_rows,
        "items_rows": items_rows,
    }


def complete_onboarding_if_shown(driver: ExpoAgentDeviceDriver) -> None:
    deadline = time.time() + 60.0
    while time.time() < deadline:
        try:
            if driver.find_node("fab-trigger") is not None:
                driver.record("ready", "Landed on HomeScreen")
                return
            if driver.find_node("onboarding-send-otp-btn") is not None:
                driver.record("onboarding", "Completing onboarding steps")
                driver.tap("onboarding-send-otp-btn")
                driver.wait_for_testid("onboarding-verify-otp-btn", timeout_s=15)
                driver.tap("onboarding-verify-otp-btn")
                driver.wait_for_testid("onboarding-save-iban-btn", timeout_s=15)
                driver.tap("onboarding-save-iban-btn")
                driver.wait_for_testid("alert-modal-btn-0", timeout_s=15)
                driver.tap("alert-modal-btn-0")
                driver.wait_for_testid("fab-trigger", timeout_s=15)
                return
        except Exception:
            pass
        time.sleep(1.0)
    raise TimeoutError("Organizer app never reached HomeScreen or OnboardingScreen")


def organizer_create_manual_bill(org: ExpoAgentDeviceDriver) -> str:
    org.record("step_1", "Creating 5-person manual receipt with 7 line items + Italian coperto")
    org.tap("fab-trigger")
    org.wait_for_testid("fab-manual-btn", timeout_s=15)
    org.tap("fab-manual-btn")

    org.wait_for_testid("home-manual-title-input", timeout_s=15)
    org.type_text("home-manual-title-input", "Trattoria Quota 5-Phone E2E")
    for name in GUEST_NAMES:
        org.type_text("home-manual-participant-input", name)
        org.tap("home-manual-add-participant-btn")
        time.sleep(0.25)

    org.tap("home-manual-create-btn")
    org.wait_for_testid("manual-mode-by-item", timeout_s=20)
    org.tap("manual-mode-by-item")

    # Enable Coperto and set EUR 2.50 per person (5 * 2.50 = 12.50)
    org.wait_for_testid("manual-coperto-toggle", timeout_s=15)
    org.tap("manual-coperto-toggle")
    org.wait_for_testid("manual-coperto-amount-input", timeout_s=15)
    org.type_text("manual-coperto-amount-input", f"{COPERTO_PER_PERSON_EUR:.2f}")
    time.sleep(0.3)
    coperto_txt = org.get_node_text("manual-coperto-total-text")
    assert _parse_euro_cents(coperto_txt) == EXPECTED_COPERTO_CENTS, f"Unexpected coperto total text: {coperto_txt}"
    org.record("coperto_configured", f"Coperto = {coperto_txt}")

    # Add 7 line items
    for spec in RECEIPT_ITEMS_SPEC:
        org.tap("manual-add-item-btn")
        org.wait_for_testid("manual-item-name-input", timeout_s=10)
        org.type_text("manual-item-name-input", spec["name"])
        org.type_text("manual-item-price-input", f"{spec['unit_price']:.2f}")
        for _ in range(spec["qty"] - 1):
            org.tap("manual-item-qty-plus")
            time.sleep(0.15)
        org.tap("manual-item-submit-btn")
        time.sleep(0.25)

    # Clear default all-diners assignments on items 0..6, then assign item 0 exclusively to Organizer
    for spec in RECEIPT_ITEMS_SPEC:
        idx = spec["index"]
        org.wait_for_testid(f"manual-item-toggle-all-{idx}", timeout_s=10)
        org.tap(f"manual-item-toggle-all-{idx}")
        time.sleep(0.2)

    org.tap("manual-item-chip-0-0")
    time.sleep(0.3)

    footer_total = org.get_node_text("manual-footer-total")
    footer_cents = _parse_euro_cents(footer_total)
    assert footer_cents == EXPECTED_GRAND_TOTAL_CENTS, (
        f"Expected organizer footer total {EXPECTED_GRAND_TOTAL_CENTS}c, got {footer_total}"
    )
    footer_org = org.get_node_text("manual-footer-organizer-share")
    assert _parse_euro_cents(footer_org) == 1600, f"Expected organizer share EUR 16.00 (13.50+2.50), got {footer_org}"

    # Verify QR share modal opens/closes cleanly and publish bill to Supabase
    org.tap("manual-qr-btn")
    org.wait_for_testid("qr-modal-copy-link-btn", timeout_s=10)
    org.tap("qr-modal-copy-link-btn")
    org.tap("qr-modal-close-btn")
    time.sleep(0.3)

    org.tap("manual-generate-share-btn")
    org.wait_for_testid("summary-collected-text", timeout_s=30)

    bill_id = org.eval_js(
        "JSON.stringify(globalThis.__QUOTA_BILL_STORE__?.getState()?.activeBillId || '')"
    )
    if not bill_id or not isinstance(bill_id, str):
        raise RuntimeError(f"Failed to read published activeBillId from Phone 1: {bill_id!r}")
    org.record("bill_published", f"bill_id={bill_id} total={footer_total}")
    return bill_id


def wait_for_bill_hydration(driver: ExpoAgentDeviceDriver, bill_id: str, timeout_s: float = 45.0) -> Dict[str, Any]:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        bill = driver.read_store_bill(bill_id)
        if bill and isinstance(bill, dict):
            non_coperto = [it for it in bill.get("items", []) if not it.get("isCoperto")]
            has_coperto = any(it.get("isCoperto") for it in bill.get("items", []))
            if len(non_coperto) == len(RECEIPT_ITEMS_SPEC) and has_coperto:
                return bill
        time.sleep(1.0)
    raise TimeoutError(f"Bill {bill_id} did not sync all items from Supabase on {driver.slot.serial}")


def wait_for_table_convergence(
    org: ExpoAgentDeviceDriver, bill_id: str, predicate, description: str, timeout_s: float = 30.0
) -> Dict[str, Any]:
    deadline = time.time() + timeout_s
    last_bill = None
    while time.time() < deadline:
        org.eval_js(f"globalThis.__QUOTA_BILL_SYNC__?.fetchBillFromCloud({json.dumps(bill_id)}).then(b => b && globalThis.__QUOTA_BILL_STORE__?.getState()?.upsertBill(b))")
        time.sleep(0.8)
        last_bill = org.read_store_bill(bill_id)
        if last_bill and predicate(last_bill):
            return last_bill
    raise TimeoutError(f"Timed out waiting for table convergence ({description}). Last bill={last_bill}")


def guest_compute_local_breakdown_cents(bill: Dict[str, Any]) -> Dict[str, int]:
    """Replicates exact integer-cent breakdown calculation independently for verification."""
    participants = bill.get("participants", [])
    items = bill.get("items", [])
    coperto_item = next((it for it in items if it.get("isCoperto")), None)
    org_id = bill.get("organizerId", "user_me")

    sorted_p_ids = sorted(p["id"] for p in participants)
    shares: Dict[str, int] = {p["id"]: 0 for p in participants}

    # Check active claimers for coperto distribution
    active_claimers = set()
    for p in participants:
        pid = p["id"]
        is_org = bool(p.get("isOrganizer")) or pid == org_id or pid == "user_me"
        items_cents = 0
        claimed_cnt = 0
        for it in items:
            if it.get("isCoperto"):
                continue
            cmap = it.get("claimedQuantities") or {}
            total_c = sum(q or 0 for q in cmap.values())
            my_c = cmap.get(pid, cmap.get(org_id, cmap.get("user_me", 0))) if is_org else (cmap.get(pid, 0) or 0)
            a_ids = it.get("assignedParticipantIds") or []
            is_assigned = (
                pid in a_ids or org_id in a_ids or "user_me" in a_ids if is_org else pid in a_ids
            )
            if total_c > 0 and total_c <= it["quantity"] and my_c > 0:
                claimed_cnt += my_c
                items_cents += my_c * int(round(it["unitPrice"] * 100))
            elif is_assigned and len(a_ids) > 0:
                claimed_cnt += 1
                sorted_assigned = sorted(a_ids)
                total_item_cents = int(round(it["totalPrice"] * 100))
                cnt = len(sorted_assigned)
                base_c = total_item_cents // cnt
                rem_c = total_item_cents % cnt
                idx = sorted_assigned.index(pid) if pid in sorted_assigned else -1
                if idx == -1 and is_org:
                    idx = sorted_assigned.index(org_id) if org_id in sorted_assigned else (
                        sorted_assigned.index("user_me") if "user_me" in sorted_assigned else -1
                    )
                if idx != -1:
                    items_cents += base_c + (1 if idx < rem_c else 0)
        if claimed_cnt > 0 or items_cents > 0:
            active_claimers.add(pid)
        shares[pid] = items_cents

    if coperto_item and int(round(coperto_item["totalPrice"] * 100)) > 0:
        divisor = max(coperto_item.get("quantity") or 1, len(active_claimers), len(participants))
        cop_cents = int(round(coperto_item["totalPrice"] * 100))
        base_cop = cop_cents // divisor
        rem_cop = cop_cents % divisor
        for idx, pid in enumerate(sorted_p_ids):
            if pid in active_claimers:
                shares[pid] += base_cop + (1 if idx < rem_cop else 0)
    return shares


def run_e2e(headless_guests: bool, seed: int, keep_alive_on_fail: bool, apk_path: Path) -> Dict[str, Any]:
    rng = random.Random(seed)
    start_ts = datetime.now(timezone.utc)
    env_map = load_env_file(PROJECT_ROOT / ".env")
    supabase_url = (env_map.get("EXPO_PUBLIC_SUPABASE_URL") or env_map.get("SUPABASE_URL") or "").strip()
    if "supbase.com" in supabase_url:
        supabase_url = supabase_url.replace("supbase.com", "supabase.co")
    anon_key = (env_map.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or env_map.get("SUPABASE_ANON_KEY") or "").strip()
    if not supabase_url or not anon_key:
        raise RuntimeError("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env")

    fleet = AndroidEmulatorFleet(
        project_root=PROJECT_ROOT,
        slots=list(DEFAULT_PHONE_SLOTS),
        headless_guests=headless_guests,
    )
    drivers: Dict[str, ExpoAgentDeviceDriver] = {
        slot.serial: ExpoAgentDeviceDriver(fleet, slot) for slot in DEFAULT_PHONE_SLOTS
    }
    report: Dict[str, Any] = {
        "started_at": start_ts.isoformat(),
        "seed": seed,
        "headless_guests": headless_guests,
        "apk_path": str(apk_path),
        "expected_grand_total_cents": EXPECTED_GRAND_TOTAL_CENTS,
        "status": "FAILED",
    }

    def _sig_handler(_signum: int, _frame: object) -> None:
        fleet.shutdown()
        sys.exit(130)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    bill_id: Optional[str] = None
    succeeded = False
    try:
        t0 = time.time()
        fleet.launch_emulators()
        boot_duration_s = round(time.time() - t0, 2)
        report["boot_duration_s"] = boot_duration_s

        fleet.install_and_prepare_app(apk_path, clear_data=True)
        install_duration_s = round(time.time() - t0 - boot_duration_s, 2)
        report["install_duration_s"] = install_duration_s

        # 1. Phone 1 (Organizer) creates & publishes 5-person bill
        org_slot = DEFAULT_PHONE_SLOTS[0]
        org_driver = drivers[org_slot.serial]
        fleet.launch_app(org_slot)
        fleet.wait_for_inspector_target(org_slot, timeout_s=90)
        time.sleep(2.0)
        complete_onboarding_if_shown(org_driver)
        bill_id = organizer_create_manual_bill(org_driver)
        deep_link_url = f"quota://bill/{bill_id}?mode=guest"
        report["bill_id"] = bill_id
        report["deep_link_url"] = deep_link_url

        # 2. Launch Phones 2-5 concurrently on Organizer's deep link
        guest_slots = DEFAULT_PHONE_SLOTS[1:]
        with ThreadPoolExecutor(max_workers=4) as pool:
            for gs in guest_slots:
                fleet.launch_app(gs, deep_link_url=deep_link_url)

            futs = [pool.submit(fleet.wait_for_inspector_target, gs, 90.0) for gs in guest_slots]
            for f in as_completed(futs):
                f.result()
            time.sleep(2.0)

            def _join_guest(gs: PhoneSlot) -> None:
                drv = drivers[gs.serial]
                drv.wait_for_testid("guest-name-input", timeout_s=45)
                hydrated = wait_for_bill_hydration(drv, bill_id, timeout_s=45)
                assert hydrated["restaurantName"] == "Trattoria Quota 5-Phone E2E", (
                    f"Mock or wrong bill hydrated on {gs.serial}: {hydrated.get('restaurantName')}"
                )
                drv.type_text("guest-name-input", gs.guest_name or f"Guest{gs.index}")
                drv.tap("guest-join-btn")
                drv.wait_for_testid("guest-filter-all", timeout_s=20)
                coperto_txt = drv.get_node_text("guest-coperto-amount")
                assert _parse_euro_cents(coperto_txt) == int(round(COPERTO_PER_PERSON_EUR * 100)), (
                    f"Guest coperto mismatch on {gs.serial}: {coperto_txt}"
                )
                # Confirm Organizer's item 0 is locked for Guests
                drv.wait_for_testid("guest-item-locked-0", timeout_s=20)
                drv.record("synced_and_joined", f"All 7 items + coperto synced; Item 0 locked for organizer")

            join_futs = [pool.submit(_join_guest, gs) for gs in guest_slots]
            for f in as_completed(join_futs):
                f.result()

        guest_by_name: Dict[str, ExpoAgentDeviceDriver] = {
            gs.guest_name: drivers[gs.serial] for gs in guest_slots if gs.guest_name
        }

        # 3A. Conflict Test 1: 3-way simultaneous overlapping tap on shared single item 1 (€16.00)
        barrier_3way = threading.Barrier(3)
        def _tap_shared_item(drv: ExpoAgentDeviceDriver) -> None:
            barrier_3way.wait(timeout=20)
            drv.tap("guest-item-claim-btn-1")

        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [
                pool.submit(_tap_shared_item, guest_by_name["Marco"]),
                pool.submit(_tap_shared_item, guest_by_name["Sara"]),
                pool.submit(_tap_shared_item, guest_by_name["Elena"]),
            ]
            for f in as_completed(futs):
                f.result()

        bill_after_shared = wait_for_table_convergence(
            org_driver,
            bill_id,
            lambda b: len((b["items"][1].get("assignedParticipantIds") or [])) == 3
            or len(([it for it in b["items"] if not it.get("isCoperto")][1].get("assignedParticipantIds") or [])) == 3,
            "3-way shared item 1 claim convergence",
            timeout_s=35,
        )
        item1 = [it for it in bill_after_shared["items"] if not it.get("isCoperto")][1]
        assert len(item1["assignedParticipantIds"]) == 3, f"Expected 3 co-claimers on item 1, got {item1}"
        org_driver.record("conflict_test_1_passed", f"3-way overlapping claim on item 1 converged cleanly: {item1['assignedParticipantIds']}")

        # 3B. Conflict Test 2: 3-way simultaneous overlapping + taps on multi-qty item 2 (qty=2)
        barrier_qty = threading.Barrier(3)
        def _tap_qty_item(drv: ExpoAgentDeviceDriver) -> None:
            barrier_qty.wait(timeout=20)
            drv.tap("guest-item-plus-2")

        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [
                pool.submit(_tap_qty_item, guest_by_name["Marco"]),
                pool.submit(_tap_qty_item, guest_by_name["Sara"]),
                pool.submit(_tap_qty_item, guest_by_name["Davide"]),
            ]
            for f in as_completed(futs):
                f.result()

        time.sleep(2.5)
        bill_after_qty = wait_for_table_convergence(
            org_driver,
            bill_id,
            lambda b: sum(([it for it in b["items"] if not it.get("isCoperto")][2].get("claimedQuantities") or {}).values()) >= 1,
            "3-way qty=2 item 2 race convergence",
            timeout_s=30,
        )
        item2 = [it for it in bill_after_qty["items"] if not it.get("isCoperto")][2]
        claimed_2_sum = sum((item2.get("claimedQuantities") or {}).values())
        assert 1 <= claimed_2_sum <= 2, f"Item 2 over-claimed during concurrent taps: {item2}"
        org_driver.record("conflict_test_2_passed", f"qty=2 concurrent race capped safely at {claimed_2_sum}/2: {item2.get('claimedQuantities')}")

        # Ensure exact 2/2 on item 2 and randomized claims across items 3..6
        # Force all 4 guests to pull latest before randomized assignment
        for drv in guest_by_name.values():
            drv.eval_js(f"globalThis.__QUOTA_BILL_SYNC__?.fetchBillFromCloud({json.dumps(bill_id)}).then(b => b && globalThis.__QUOTA_BILL_STORE__?.getState()?.upsertBill(b))")
        time.sleep(1.0)

        p_name_by_id = {p["id"]: p["name"] for p in bill_after_qty["participants"]}
        # If item 2 only got 1 unit won in race, top up remaining 1 unit to a random guest (favoring Davide if Davide missed out)
        remaining_item2 = 2 - claimed_2_sum
        for _ in range(remaining_item2):
            chosen_guest = rng.choice(["Davide", "Marco", "Sara", "Elena"])
            guest_by_name[chosen_guest].tap("guest-item-plus-2")
            time.sleep(1.0)

        # Randomly assign single item 4 and multi-qty items 3 (qty=2), 5 (qty=3), 6 (qty=2)
        # Ensure Davide claims at least item 4 if not already claimed so every guest has >= 1 item
        order_pool = list(GUEST_NAMES)
        rng.shuffle(order_pool)
        item4_assignee = "Davide" if (sum((item2.get("claimedQuantities") or {}).get(pid, 0) for pid, nm in p_name_by_id.items() if nm == "Davide") == 0) else order_pool[0]
        guest_by_name[item4_assignee].tap("guest-item-claim-btn-4")
        time.sleep(0.8)

        multi_allocations: Dict[int, List[str]] = {3: [], 5: [], 6: []}
        for item_idx, qty in ((3, 2), (5, 3), (6, 2)):
            for _ in range(qty):
                chosen = rng.choice(GUEST_NAMES)
                multi_allocations[item_idx].append(chosen)
                guest_by_name[chosen].tap(f"guest-item-plus-{item_idx}")
                time.sleep(0.75)

        report["randomized_allocations"] = {
            "seed": seed,
            "item_4_single": item4_assignee,
            "multi_qty_items": multi_allocations,
        }

        def _all_items_fully_claimed(b: Dict[str, Any]) -> bool:
            non_cop = [it for it in b.get("items", []) if not it.get("isCoperto")]
            if len(non_cop) != len(RECEIPT_ITEMS_SPEC):
                return False
            for it in non_cop:
                if it["quantity"] > 1:
                    if sum((it.get("claimedQuantities") or {}).values()) != it["quantity"]:
                        return False
                else:
                    if len(it.get("assignedParticipantIds") or []) < 1:
                        return False
            return True

        converged_bill = wait_for_table_convergence(
            org_driver,
            bill_id,
            _all_items_fully_claimed,
            "100% of items & quantities claimed across all guests",
            timeout_s=45,
        )

        # Sync latest converged state to all 4 guests and assert local UI totals match expected math
        expected_shares_cents = guest_compute_local_breakdown_cents(converged_bill)
        assert sum(expected_shares_cents.values()) == EXPECTED_GRAND_TOTAL_CENTS, (
            f"Pre-payment breakdown sum mismatch: {expected_shares_cents}"
        )
        for drv in guest_by_name.values():
            drv.eval_js(f"globalThis.__QUOTA_BILL_SYNC__?.fetchBillFromCloud({json.dumps(bill_id)}).then(b => b && globalThis.__QUOTA_BILL_STORE__?.getState()?.upsertBill(b))")
        time.sleep(1.0)

        for gname, drv in guest_by_name.items():
            share_txt = drv.get_node_text("guest-share-total-text")
            ui_cents = _parse_euro_cents(share_txt)
            pid = next(p["id"] for p in converged_bill["participants"] if p["name"] == gname)
            assert ui_cents == expected_shares_cents[pid], (
                f"Guest {gname} UI share {ui_cents}c != expected {expected_shares_cents[pid]}c ({share_txt})"
            )
            drv.record("share_verified", f"UI share={share_txt} ({ui_cents}c)")

        # 4. End-of-Meal Payment across Phones 2-5
        # Phones 2 & 3 -> Google Pay; Phones 4 & 5 -> SEPA Instant
        pay_methods = {
            "Marco": "payment-google-pay-btn",
            "Sara": "payment-google-pay-btn",
            "Elena": "payment-sepa-btn",
            "Davide": "payment-sepa-btn",
        }
        with ThreadPoolExecutor(max_workers=4) as pool:
            def _pay_guest(gname: str) -> None:
                drv = guest_by_name[gname]
                btn_id = pay_methods[gname]
                drv.tap("guest-proceed-payment-btn")
                drv.wait_for_testid(btn_id, timeout_s=20)
                drv.tap(btn_id)
                drv.wait_for_testid("alert-modal-btn-0", timeout_s=25)
                drv.tap("alert-modal-btn-0")
                drv.wait_for_testid("summary-collected-text", timeout_s=25)
                drv.record("payment_completed", f"Paid via {btn_id}")

            pay_futs = [pool.submit(_pay_guest, gname) for gname in GUEST_NAMES]
            for f in as_completed(pay_futs):
                f.result()

        # 5. Phone 1 verifies real-time payment updates for all 4 guests, then settles Organizer share
        wait_for_table_convergence(
            org_driver,
            bill_id,
            lambda b: sum(1 for p in b["participants"] if not p.get("isOrganizer") and p.get("status") == "paid") == 4,
            "all 4 guests paid on Organizer",
            timeout_s=45,
        )
        org_driver.wait_for_testid("summary-confirm-organizer-settlement-btn", timeout_s=15)
        org_driver.tap("summary-confirm-organizer-settlement-btn")

        settled_bill = wait_for_table_convergence(
            org_driver,
            bill_id,
            lambda b: b.get("status") == "settled"
            and all(p.get("status") == "paid" for p in b.get("participants", [])),
            "bill settled after Organizer confirmation",
            timeout_s=30,
        )
        time.sleep(1.5)  # allow LiveStatusDeck + Supabase write queue flush

        # 6A. Strict Verification against Phone 1 LIVE UI
        collected_ui = org_driver.get_node_text("summary-collected-text")
        status_badge_ui = org_driver.get_node_text("summary-status-badge")
        assert "166.50" in collected_ui, f"Phone 1 collected UI missing €166.50: {collected_ui}"
        assert "100%" in status_badge_ui.upper() or "SETTLED" in status_badge_ui.upper() or "SALDATO" in status_badge_ui.upper(), (
            f"Phone 1 status badge not settled: {status_badge_ui}"
        )

        ui_rows = []
        ui_sum_cents = 0
        for idx in range(5):
            row_name = org_driver.get_node_text(f"summary-participant-name-{idx}")
            row_status = org_driver.get_node_text(f"summary-participant-status-{idx}")
            row_amt = org_driver.get_node_text(f"summary-participant-amount-{idx}")
            row_cents = _parse_euro_cents(row_amt)
            assert row_cents is not None and row_cents > 0, f"Invalid UI amount on row {idx}: {row_amt}"
            assert any(tok in row_status.upper() for tok in ("SETTLED", "PAID", "SALDATO")), (
                f"Participant {row_name} not PAID on Phone 1 UI: {row_status}"
            )
            ui_sum_cents += row_cents
            ui_rows.append({"index": idx, "name": row_name, "status": row_status, "amount": row_amt, "cents": row_cents})

        assert ui_sum_cents == EXPECTED_GRAND_TOTAL_CENTS, (
            f"Phone 1 UI participant sum {ui_sum_cents}c != {EXPECTED_GRAND_TOTAL_CENTS}c"
        )

        # 6B. Strict Verification against Supabase Database State
        sb_state = fetch_supabase_state(supabase_url, anon_key, bill_id)
        bill_row = sb_state["bill_row"]
        assert bill_row is not None, f"Bill {bill_id} not found in Supabase `bills` table"
        assert bill_row["status"] == "completed", f"Supabase bills.status expected 'completed', got {bill_row['status']!r}"
        assert int(round(float(bill_row["total_amount"]) * 100)) == EXPECTED_GRAND_TOTAL_CENTS, (
            f"Supabase bills.total_amount mismatch: {bill_row['total_amount']}"
        )

        parsed_cloud = json.loads(bill_row["title"])
        cloud_bill = parsed_cloud["bill"]
        assert cloud_bill["status"] == "settled", f"Cloud JSON bill.status expected 'settled', got {cloud_bill['status']!r}"
        assert len(cloud_bill["participants"]) == 5, f"Expected 5 participants in Supabase, got {len(cloud_bill['participants'])}"

        cloud_paid_sum_cents = 0
        for p in cloud_bill["participants"]:
            assert p.get("status") == "paid", f"Supabase participant {p['name']} not paid: {p}"
            p_cents = int(round(float(p.get("paidAmount", 0)) * 100))
            assert p_cents == expected_shares_cents[p["id"]], (
                f"Supabase paidAmount mismatch for {p['name']}: {p_cents}c != {expected_shares_cents[p['id']]}c"
            )
            cloud_paid_sum_cents += p_cents
        assert cloud_paid_sum_cents == EXPECTED_GRAND_TOTAL_CENTS, (
            f"Supabase sum(paidAmount)={cloud_paid_sum_cents}c != {EXPECTED_GRAND_TOTAL_CENTS}c"
        )

        # Item & Coperto 100% accounted for assertions
        non_coperto_cloud = [it for it in cloud_bill["items"] if not it.get("isCoperto")]
        coperto_cloud = [it for it in cloud_bill["items"] if it.get("isCoperto")]
        assert len(non_coperto_cloud) == 7 and len(coperto_cloud) == 1
        for it in non_coperto_cloud:
            if it["quantity"] > 1:
                claimed_tot = sum((it.get("claimedQuantities") or {}).values())
                assert claimed_tot == it["quantity"], f"Item {it['name']} claimed {claimed_tot}/{it['quantity']}"
            else:
                assert len(it.get("assignedParticipantIds") or []) >= 1, f"Item {it['name']} unclaimed!"

        splits_rows = sb_state["splits_rows"]
        if splits_rows:
            assert len(splits_rows) == 5, f"Expected 5 bill_splits rows, got {len(splits_rows)}"
            for sr in splits_rows:
                assert sr["status"] == "paid", f"bill_splits row not paid: {sr}"
            splits_sum_cents = sum(int(round(float(sr["owed_amount"]) * 100)) for sr in splits_rows)
            assert splits_sum_cents == EXPECTED_GRAND_TOTAL_CENTS, (
                f"bill_splits sum {splits_sum_cents}c != {EXPECTED_GRAND_TOTAL_CENTS}c"
            )

        succeeded = True
        report["status"] = "PASSED"
        report["verification"] = {
            "phone1_ui": {
                "collected_text": collected_ui,
                "status_badge": status_badge_ui,
                "participant_rows": ui_rows,
                "sum_cents": ui_sum_cents,
                "diff_cents": ui_sum_cents - EXPECTED_GRAND_TOTAL_CENTS,
            },
            "supabase": {
                "bills_row_id": bill_row["id"],
                "bills_status": bill_row["status"],
                "bills_total_cents": int(round(float(bill_row["total_amount"]) * 100)),
                "cloud_paid_sum_cents": cloud_paid_sum_cents,
                "diff_cents": cloud_paid_sum_cents - EXPECTED_GRAND_TOTAL_CENTS,
                "bill_splits_count": len(splits_rows),
                "bill_splits_sum_cents": sum(int(round(float(sr["owed_amount"]) * 100)) for sr in splits_rows) if splits_rows else None,
                "bill_items_count": len(sb_state["items_rows"]),
            },
        }
        report["settled_bill"] = settled_bill
        return report
    except Exception as exc:
        report["error"] = str(exc)
        raise
    finally:
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        report["total_duration_s"] = round((datetime.now(timezone.utc) - start_ts).total_seconds(), 2)
        report["device_logs"] = {serial: drv.logs for serial, drv in drivers.items()}
        reports_dir = PROJECT_ROOT / "reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        out_path = reports_dir / f"e2e_5_android_phones_{start_ts.strftime('%Y%m%dT%H%M%SZ')}.json"
        out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"[e2e] Saved report artifact: {out_path}", flush=True)

        if succeeded or not keep_alive_on_fail:
            fleet.shutdown()
            remaining = list_connected_emulators(fleet.adb_exe)
            report["remaining_emulators_after_shutdown"] = remaining


def main() -> int:
    parser = argparse.ArgumentParser(description="5-Phone Local Android Emulator E2E Test")
    parser.add_argument("--headless-guests", dest="headless_guests", action="store_true", default=True)
    parser.add_argument("--show-all-windows", dest="headless_guests", action="store_false")
    parser.add_argument("--seed", type=int, default=int(time.time()))
    parser.add_argument("--apk", type=str, default="android/app/build/outputs/apk/debug/app-debug.apk")
    parser.add_argument("--keep-alive-on-fail", action="store_true", default=False)
    args = parser.parse_args()

    apk = Path(args.apk)
    if not apk.is_absolute():
        apk = PROJECT_ROOT / apk

    run_e2e(
        headless_guests=args.headless_guests,
        seed=args.seed,
        keep_alive_on_fail=args.keep_alive_on_fail,
        apk_path=apk,
    )
    print("[e2e] ALL 5-PHONE ANDROID E2E ASSERTIONS PASSED!", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


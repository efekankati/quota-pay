"""Local Multi-Emulator Android E2E Test for Quota Pay.

Runs against 1 Organizer + N Guests concurrent local Android Emulators
(up to 9 guests with `--headless-guests` [10 phones total], or up to 3 guests
with `--show-all-windows` [4 phones total]) driven via `ANDROID_SERIAL` +
`adb -s` + `@expo/agent-cli` runtime commands:
  - Phone 1 (emulator-5554): Organizer creates a (1+N)-person itemized bill + coperto
  - Phones 2..1+N (emulator-5556..): Guests join concurrently via `quota://` deep link,
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
from typing import Any, Callable, Dict, List, Optional, Tuple
import uuid

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from e2e.e2e_telemetry import (  # noqa: E402
    E2EEvent,
    E2EEventBus,
    JsonlTimelineObserver,
    LiveSSEServerObserver,
    _E2EStageTracker,
    build_terminal_observer,
    write_markdown_audit_report,
)
from scripts.android_emulator_fleet import (  # noqa: E402
    AndroidEmulatorFleet,
    DEFAULT_BOOT_BATCH_SIZE,
    DEFAULT_GUEST_RAM_MB,
    DEFAULT_PHONE_SLOTS,
    PhoneSlot,
    VISIBLE_GUEST_RAM_MB,
    build_phone_slots,
    list_connected_emulators,
    run_cmd,
)


MAX_HEADLESS_GUESTS = 9
MAX_VISIBLE_GUESTS = 3
ALL_GUEST_NAMES = ["Marco", "Sara", "Elena", "Davide", "Giulia", "Luca", "Chiara", "Matteo", "Sofia"]

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
GUEST_NAMES = list(ALL_GUEST_NAMES[:4])
EXPECTED_ITEMS_CENTS = sum(int(round(i["unit_price"] * 100)) * i["qty"] for i in RECEIPT_ITEMS_SPEC)  # 15400
EXPECTED_COPERTO_CENTS = int(round(COPERTO_PER_PERSON_EUR * 100)) * 5  # 1250
EXPECTED_GRAND_TOTAL_CENTS = EXPECTED_ITEMS_CENTS + EXPECTED_COPERTO_CENTS  # 16650 (€166.50)


def validate_guest_config(num_guests: int, headless_guests: bool) -> None:
    """Enforce guest-count bounds for headless (1..9) vs visible-window (1..3) runs."""
    max_allowed = MAX_HEADLESS_GUESTS if headless_guests else MAX_VISIBLE_GUESTS
    mode_label = "--headless-guests" if headless_guests else "--show-all-windows"
    if 1 <= num_guests <= max_allowed:
        return
    print(
        (
            f"ERROR: Invalid guest count ({num_guests}) for {mode_label}.\n"
            f"Allowed conditions:\n"
            f"  - With --headless-guests  : 1 to {MAX_HEADLESS_GUESTS} guests (up to {1 + MAX_HEADLESS_GUESTS} emulators total; Organizer visible + headless guests)\n"
            f"  - With --show-all-windows : 1 to {MAX_VISIBLE_GUESTS} guests (up to {1 + MAX_VISIBLE_GUESTS} visible emulator windows)\n"
            f"Input rejected without launching any emulator."
        ),
        file=sys.stderr,
        flush=True,
    )
    raise SystemExit(2)


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

    def __init__(
        self,
        fleet: AndroidEmulatorFleet,
        slot: PhoneSlot,
        on_event: Optional[Callable[[str, str, str], None]] = None,
        quiet_stdout: bool = False,
    ) -> None:
        self.fleet = fleet
        self.slot = slot
        self._on_event = on_event
        self._quiet_stdout = quiet_stdout
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
        if self._on_event is not None:
            try:
                self._on_event(self.slot.serial, action, detail)
            except Exception:
                pass
        if not self._quiet_stdout:
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
            "800",
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


def organizer_create_manual_bill(
    org: ExpoAgentDeviceDriver,
    active_guest_names: List[str],
    bill_title: str,
    expected_coperto_cents: int,
    expected_grand_total_cents: int,
) -> str:
    total_diners = 1 + len(active_guest_names)
    org.record(
        "step_1",
        f"Creating {total_diners}-person manual receipt with 7 line items + Italian coperto",
    )
    org.tap("fab-trigger")
    org.wait_for_testid("fab-manual-btn", timeout_s=15)
    org.tap("fab-manual-btn")

    org.wait_for_testid("home-manual-title-input", timeout_s=15)
    org.type_text("home-manual-title-input", bill_title)
    for name in active_guest_names:
        org.type_text("home-manual-participant-input", name)
        org.tap("home-manual-add-participant-btn")
        time.sleep(0.25)

    org.tap("home-manual-create-btn")
    org.wait_for_testid("manual-mode-by-item", timeout_s=20)
    org.tap("manual-mode-by-item")

    # Enable Coperto and set EUR 2.50 per person
    org.wait_for_testid("manual-coperto-toggle", timeout_s=15)
    org.tap("manual-coperto-toggle")
    org.wait_for_testid("manual-coperto-amount-input", timeout_s=15)
    org.type_text("manual-coperto-amount-input", f"{COPERTO_PER_PERSON_EUR:.2f}")
    time.sleep(0.3)
    coperto_txt = org.get_node_text("manual-coperto-total-text")
    assert _parse_euro_cents(coperto_txt) == expected_coperto_cents, (
        f"Unexpected coperto total text: {coperto_txt} (expected {expected_coperto_cents}c)"
    )
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

    footer_total = org.get_node_text("manual-footer-total")
    footer_cents = _parse_euro_cents(footer_total)
    assert footer_cents == expected_grand_total_cents, (
        f"Expected organizer footer total {expected_grand_total_cents}c, got {footer_total}"
    )
    footer_org = ""
    org_deadline = time.time() + 5.0
    while time.time() < org_deadline:
        footer_org = org.get_node_text("manual-footer-organizer-share")
        if _parse_euro_cents(footer_org) == 1600:
            break
        time.sleep(0.3)
    if _parse_euro_cents(footer_org) != 1600:
        diag = org.eval_js(
            "(() => { const s = globalThis.__QUOTA_BILL_STORE__?.getState(); "
            "const b = s?.bills?.find(x => x.id === s.activeBillId) || s?.bills?.[0]; "
            "return JSON.stringify((b?.items || []).filter(i => !i.isCoperto).map((i, idx) => "
            "({ idx, name: i.name, total: i.totalPrice, assigned: i.assignedParticipantIds?.length || 0 }))); })()"
        )
        raise AssertionError(
            f"Expected organizer share EUR 16.00 (13.50+2.50), got {footer_org}; item_assignments={diag}"
        )

    # Verify QR share modal opens/closes cleanly and publish bill to Supabase
    org.tap("manual-qr-btn")
    org.wait_for_testid("qr-modal-copy-link-btn", timeout_s=10)
    org.tap("qr-modal-copy-link-btn")
    org.tap("qr-modal-close-btn")
    time.sleep(0.3)

    org.tap("manual-generate-share-btn")
    org.wait_for_testid("summary-collected-text", timeout_s=45)

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


def run_e2e(
    num_guests: int,
    headless_guests: bool,
    seed: int,
    keep_alive_on_fail: bool,
    apk_path: Path,
    no_tui: bool = False,
    enable_ui: bool = False,
    ui_port: int = 8765,
    ui_keep_open: bool = False,
    json_mode: bool = False,
    guest_ram_mb: Optional[int] = None,
    boot_batch_size: int = DEFAULT_BOOT_BATCH_SIZE,
    no_snapshot: bool = False,
    keep_alive: bool = False,
    reuse_running: bool = False,
    guest_gpu: str = "swiftshader_indirect",
) -> Dict[str, Any]:
    validate_guest_config(num_guests, headless_guests)
    resolved_guest_ram = (
        guest_ram_mb
        if guest_ram_mb is not None
        else (DEFAULT_GUEST_RAM_MB if headless_guests else VISIBLE_GUEST_RAM_MB)
    )
    guest_ram_mb = resolved_guest_ram
    slots = build_phone_slots(num_guests, headless_guests=headless_guests)
    active_guest_names = list(ALL_GUEST_NAMES[:num_guests])
    total_diners = 1 + num_guests
    expected_coperto_cents = int(round(COPERTO_PER_PERSON_EUR * 100)) * total_diners
    expected_grand_total_cents = EXPECTED_ITEMS_CENTS + expected_coperto_cents
    expected_grand_total_str = f"{expected_grand_total_cents / 100:.2f}"
    bill_title = f"Trattoria Quota {total_diners}-Phone E2E"
    convergence_timeout_s = float(max(45, 15 * num_guests))

    rng = random.Random(seed)
    start_ts = datetime.now(timezone.utc)
    ts_slug = start_ts.strftime("%Y%m%dT%H%M%SZ")
    run_id = f"e2e-{uuid.uuid4().hex[:10]}"

    reports_dir = PROJECT_ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    timeline_path = reports_dir / f"e2e_state_timeline_{ts_slug}.jsonl"
    audit_md_path = reports_dir / f"e2e_deployment_audit_{ts_slug}.md"
    out_path = reports_dir / f"e2e_{total_diners}_android_phones_{ts_slug}.json"

    env_map = load_env_file(PROJECT_ROOT / ".env")
    supabase_url = (env_map.get("EXPO_PUBLIC_SUPABASE_URL") or env_map.get("SUPABASE_URL") or "").strip()
    if "supbase.com" in supabase_url:
        supabase_url = supabase_url.replace("supbase.com", "supabase.co")
    anon_key = (env_map.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or env_map.get("SUPABASE_ANON_KEY") or "").strip()
    if not supabase_url or not anon_key:
        raise RuntimeError("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env")

    slots_meta = [
        {
            "index": s.index,
            "serial": s.serial,
            "avd": s.avd,
            "role": s.role,
            "guest_name": s.guest_name,
            "proxy_port": s.proxy_port,
            "headless": bool(headless_guests and s.index > 1),
        }
        for s in slots
    ]

    bus = E2EEventBus(run_id=run_id)
    tracker = _E2EStageTracker(
        run_id=run_id,
        num_guests=num_guests,
        headless_guests=headless_guests,
        slots_meta=slots_meta,
    )
    bus.subscribe(tracker.update)

    jsonl_obs = JsonlTimelineObserver(timeline_path)
    bus.subscribe(jsonl_obs.on_state_change)

    ui_server: Optional[LiveSSEServerObserver] = None
    ui_url: Optional[str] = None
    if enable_ui or ui_keep_open:
        ui_server = LiveSSEServerObserver(
            port=ui_port,
            run_id=run_id,
            num_guests=num_guests,
            headless_guests=headless_guests,
            slots_meta=slots_meta,
        )
        ui_url = ui_server.start()
        bus.subscribe(ui_server.on_state_change)
        target_stream = sys.stderr if json_mode else sys.stdout
        print(f"Live E2E Deployment Dashboard: {ui_url}", file=target_stream, flush=True)

    term_obs = build_terminal_observer(
        run_id=run_id,
        num_guests=num_guests,
        headless_guests=headless_guests,
        slots_meta=slots_meta,
        no_tui=no_tui,
        json_mode=json_mode,
        ui_url=ui_url,
    )
    bus.subscribe(term_obs.on_state_change)

    current_stage_box: List[str] = ["fleet_bootstrap"]
    stage_t0_box: List[float] = [time.perf_counter()]

    def _begin_stage(stage_id: str, step: str, detail: str = "", device_serial: Optional[str] = None) -> float:
        current_stage_box[0] = stage_id
        stage_t0_box[0] = time.perf_counter()
        bus.emit(
            E2EEvent(
                stage_id=stage_id,
                status="RUNNING",
                step=step,
                detail=detail,
                device_serial=device_serial,
                run_id=run_id,
            )
        )
        return stage_t0_box[0]

    def _end_stage(stage_id: str, step: str, t0_stage: float, detail: str = "", device_serial: Optional[str] = None) -> None:
        bus.emit(
            E2EEvent(
                stage_id=stage_id,
                status="PASSED",
                step=step,
                detail=detail,
                device_serial=device_serial,
                duration_ms=round((time.perf_counter() - t0_stage) * 1000.0, 1),
                run_id=run_id,
            )
        )

    def _on_fleet_event(serial: str, event_name: str, detail: str) -> None:
        stage_id = current_stage_box[0]
        is_retry = event_name == "inspector_retry"
        dev_serial = serial if serial.startswith("emulator-") else None
        bus.emit(
            E2EEvent(
                stage_id=stage_id,
                status="RETRYING" if is_retry else "RUNNING",
                step=event_name,
                detail=detail,
                device_serial=dev_serial,
                retry_count=1 if is_retry else 0,
                run_id=run_id,
            )
        )

    def _on_driver_event(serial: str, action: str, detail: str) -> None:
        bus.emit(
            E2EEvent(
                stage_id=current_stage_box[0],
                status="RUNNING",
                step=action,
                detail=detail,
                device_serial=serial,
                run_id=run_id,
            )
        )

    fleet = AndroidEmulatorFleet(
        project_root=PROJECT_ROOT,
        slots=slots,
        headless_guests=headless_guests,
        guest_ram_mb=guest_ram_mb,
        boot_batch_size=boot_batch_size,
        guest_gpu_mode=guest_gpu,
        on_event=_on_fleet_event,
        quiet_stdout=True,
    )
    drivers: Dict[str, ExpoAgentDeviceDriver] = {
        slot.serial: ExpoAgentDeviceDriver(
            fleet,
            slot,
            on_event=_on_driver_event,
            quiet_stdout=True,
        )
        for slot in slots
    }
    report: Dict[str, Any] = {
        "run_id": run_id,
        "started_at": start_ts.isoformat(),
        "seed": seed,
        "num_guests": num_guests,
        "total_diners": total_diners,
        "headless_guests": headless_guests,
        "guest_ram_mb": guest_ram_mb,
        "boot_batch_size": boot_batch_size,
        "use_snapshot": not no_snapshot,
        "keep_alive": keep_alive,
        "reuse_running": reuse_running,
        "guest_gpu": guest_gpu,
        "apk_path": str(apk_path),
        "expected_grand_total_cents": expected_grand_total_cents,
        "report_json_path": str(out_path),
        "audit_md_path": str(audit_md_path),
        "state_timeline_path": str(timeline_path),
        "status": "FAILED",
    }

    def _sig_handler(_signum: int, _frame: object) -> None:
        try:
            term_obs.stop()
        except Exception:
            pass
        if ui_server is not None:
            try:
                ui_server.stop()
            except Exception:
                pass
        try:
            jsonl_obs.close()
        except Exception:
            pass
        fleet.shutdown(keep_emulators_alive=False)
        sys.exit(130)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    bill_id: Optional[str] = None
    succeeded = False
    run_t0 = time.perf_counter()
    final_snapshot: Dict[str, Any] = {}
    term_obs.start()

    try:
        try:
            bus.emit(
                E2EEvent(
                    stage_id="pipeline",
                    status="RUNNING",
                    step=f"starting {total_diners}-phone E2E pipeline",
                    detail=(
                        f"diners=1+{num_guests}, mode={'headless' if headless_guests else 'visible'}, "
                        f"guest_ram={guest_ram_mb}MB, batch={boot_batch_size}"
                    ),
                    run_id=run_id,
                )
            )

            # Stage 1: Fleet & Metro Bootstrap
            st1 = _begin_stage(
                "fleet_bootstrap",
                "running pre-flight checks, AVD setup, Metro & CDP proxies",
                detail=f"{total_diners} slot(s), guest_ram={guest_ram_mb}MB",
            )
            preflight = fleet.prepare_host_infrastructure(reuse_running=reuse_running)
            report["preflight"] = preflight
            _end_stage(
                "fleet_bootstrap",
                "host infrastructure ready",
                st1,
                detail=(
                    f"{len(slots)} AVDs on ports {slots[0].proxy_port}..{slots[-1].proxy_port} | "
                    f"free_ram={preflight.get('free_host_ram_mb', '-')}MB"
                ),
            )

            # Stage 2: Emulator Boot & ADB Ready
            st2 = _begin_stage(
                "emulator_boot",
                f"booting {total_diners} emulator(s) in batches of {boot_batch_size}",
                detail=f"snapshot={'enabled' if not no_snapshot else 'disabled'}, reuse_running={reuse_running}",
            )
            fleet.boot_emulators(
                batch_size=boot_batch_size,
                reuse_running=reuse_running,
                use_snapshot=not no_snapshot,
            )
            boot_duration_s = round(time.perf_counter() - st2, 2)
            report["boot_duration_s"] = boot_duration_s
            _end_stage(
                "emulator_boot",
                f"all {total_diners} emulators ready",
                st2,
                detail=f"booted in {boot_duration_s}s",
            )

            # Stage 3: APK Deploy & Debug Host
            st3 = _begin_stage(
                "apk_deploy",
                f"deploying/resetting {apk_path.name} across {total_diners} device(s)",
                detail="verifying SHA match or installing + wiring debug_http_host",
            )
            fleet.install_and_prepare_app(apk_path, clear_data=True)
            fleet.clear_logcat_buffers()
            install_duration_s = round(time.perf_counter() - st3, 2)
            report["install_duration_s"] = install_duration_s
            _end_stage(
                "apk_deploy",
                f"APK ready on {total_diners} device(s)",
                st3,
                detail=f"prepared in {install_duration_s}s",
            )

            # Stage 4: Organizer Manual Bill
            org_slot = slots[0]
            org_driver = drivers[org_slot.serial]
            st4 = _begin_stage(
                "organizer_bill",
                "launching Organizer & creating manual bill",
                detail=f"{total_diners} diners, 7 items + coperto",
                device_serial=org_slot.serial,
            )
            fleet.launch_app(org_slot)
            fleet.wait_for_inspector_target(org_slot, timeout_s=120)
            time.sleep(2.0)
            complete_onboarding_if_shown(org_driver)
            bill_id = organizer_create_manual_bill(
                org_driver,
                active_guest_names=active_guest_names,
                bill_title=bill_title,
                expected_coperto_cents=expected_coperto_cents,
                expected_grand_total_cents=expected_grand_total_cents,
            )
            deep_link_url = f"quota://bill/{bill_id}?mode=guest"
            report["bill_id"] = bill_id
            report["deep_link_url"] = deep_link_url
            _end_stage(
                "organizer_bill",
                "bill created & published to Supabase",
                st4,
                detail=f"bill_id={bill_id}, total=EUR {expected_grand_total_str}",
                device_serial=org_slot.serial,
            )

            # Stage 5: Guests Join & Live Sync
            guest_slots = slots[1:]
            st5 = _begin_stage(
                "guests_join_sync",
                f"launching {num_guests} guest(s) via deep link",
                detail=deep_link_url,
            )
            with ThreadPoolExecutor(max_workers=min(4, num_guests)) as pool:
                for gs in guest_slots:
                    fleet.launch_app(gs, deep_link_url=deep_link_url)

                futs = [pool.submit(fleet.wait_for_inspector_target, gs, 120.0) for gs in guest_slots]
                for f in as_completed(futs):
                    f.result()
                time.sleep(2.0)

                def _join_guest(gs: PhoneSlot) -> None:
                    drv = drivers[gs.serial]
                    drv.wait_for_testid("guest-name-input", timeout_s=45)
                    hydrated = wait_for_bill_hydration(drv, bill_id, timeout_s=45)
                    assert hydrated["restaurantName"] == bill_title, (
                        f"Mock or wrong bill hydrated on {gs.serial}: {hydrated.get('restaurantName')}"
                    )
                    drv.type_text("guest-name-input", gs.guest_name or f"Guest{gs.index}")
                    drv.tap("guest-join-btn")
                    drv.wait_for_testid("guest-filter-all", timeout_s=20)
                    coperto_txt = drv.get_node_text("guest-coperto-amount")
                    assert _parse_euro_cents(coperto_txt) == int(round(COPERTO_PER_PERSON_EUR * 100)), (
                        f"Guest coperto mismatch on {gs.serial}: {coperto_txt}"
                    )
                    drv.wait_for_testid("guest-item-locked-0", timeout_s=20)
                    drv.record("synced_and_joined", "All 7 items + coperto synced; Item 0 locked for organizer")

                join_futs = [pool.submit(_join_guest, gs) for gs in guest_slots]
                for f in as_completed(join_futs):
                    f.result()

            _end_stage(
                "guests_join_sync",
                f"{num_guests}/{num_guests} guests joined & hydrated",
                st5,
                detail=f"all 7 items + coperto synced cleanly",
            )

            guest_by_name: Dict[str, ExpoAgentDeviceDriver] = {
                gs.guest_name: drivers[gs.serial] for gs in guest_slots if gs.guest_name
            }

            # Stage 6: Conflict Barriers & Claims
            st6 = _begin_stage(
                "claims_and_conflicts",
                "running overlapping conflict barriers & claims",
                detail=f"seed={seed}",
            )
            shared_guests = active_guest_names[: min(3, num_guests)]
            barrier_shared = threading.Barrier(len(shared_guests))

            def _tap_shared_item(drv: ExpoAgentDeviceDriver) -> None:
                barrier_shared.wait(timeout=20)
                drv.tap("guest-item-claim-btn-1")

            with ThreadPoolExecutor(max_workers=len(shared_guests)) as pool:
                futs = [pool.submit(_tap_shared_item, guest_by_name[gn]) for gn in shared_guests]
                for f in as_completed(futs):
                    f.result()

            bill_after_shared = wait_for_table_convergence(
                org_driver,
                bill_id,
                lambda b: len(
                    ([it for it in b.get("items", []) if not it.get("isCoperto")][1].get("assignedParticipantIds") or [])
                )
                == len(shared_guests),
                f"{len(shared_guests)}-way shared item 1 claim convergence",
                timeout_s=convergence_timeout_s,
            )
            item1 = [it for it in bill_after_shared["items"] if not it.get("isCoperto")][1]
            assert len(item1["assignedParticipantIds"]) == len(shared_guests), (
                f"Expected {len(shared_guests)} co-claimers on item 1, got {item1}"
            )
            org_driver.record(
                "conflict_test_1_passed",
                f"{len(shared_guests)}-way overlapping claim on item 1 converged cleanly: {item1['assignedParticipantIds']}",
            )

            if num_guests >= 3:
                race_guests = [active_guest_names[0], active_guest_names[1], active_guest_names[-1]]
            else:
                race_guests = list(active_guest_names)
            barrier_qty = threading.Barrier(len(race_guests))

            def _tap_qty_item(drv: ExpoAgentDeviceDriver) -> None:
                barrier_qty.wait(timeout=20)
                drv.tap("guest-item-plus-2")

            with ThreadPoolExecutor(max_workers=len(race_guests)) as pool:
                futs = [pool.submit(_tap_qty_item, guest_by_name[gn]) for gn in race_guests]
                for f in as_completed(futs):
                    f.result()

            time.sleep(2.5)
            bill_after_qty = wait_for_table_convergence(
                org_driver,
                bill_id,
                lambda b: sum(([it for it in b["items"] if not it.get("isCoperto")][2].get("claimedQuantities") or {}).values()) >= 1,
                "qty=2 item 2 race convergence",
                timeout_s=convergence_timeout_s,
            )
            item2 = [it for it in bill_after_qty["items"] if not it.get("isCoperto")][2]
            claimed_2_sum = sum((item2.get("claimedQuantities") or {}).values())
            assert 1 <= claimed_2_sum <= 2, f"Item 2 over-claimed during concurrent taps: {item2}"
            org_driver.record(
                "conflict_test_2_passed",
                f"qty=2 concurrent race capped safely at {claimed_2_sum}/2: {item2.get('claimedQuantities')}",
            )

            for drv in guest_by_name.values():
                drv.eval_js(
                    f"globalThis.__QUOTA_BILL_SYNC__?.fetchBillFromCloud({json.dumps(bill_id)}).then(b => b && globalThis.__QUOTA_BILL_STORE__?.getState()?.upsertBill(b))"
                )
            time.sleep(1.0)

            p_id_by_name = {p["name"]: p["id"] for p in bill_after_qty["participants"]}
            covered_pids = set()
            for it in bill_after_qty.get("items", []):
                if it.get("isCoperto"):
                    continue
                for pid, q in (it.get("claimedQuantities") or {}).items():
                    if q and q > 0:
                        covered_pids.add(pid)
                for pid in it.get("assignedParticipantIds") or []:
                    covered_pids.add(pid)

            uncovered_guests = [gn for gn in active_guest_names if p_id_by_name.get(gn) not in covered_pids]
            rng.shuffle(uncovered_guests)

            def _pick_guest() -> str:
                return uncovered_guests.pop(0) if uncovered_guests else rng.choice(active_guest_names)

            remaining_item2 = 2 - claimed_2_sum
            for _ in range(remaining_item2):
                chosen_guest = _pick_guest()
                guest_by_name[chosen_guest].tap("guest-item-plus-2")
                time.sleep(0.9)

            item4_assignee = _pick_guest()
            guest_by_name[item4_assignee].tap("guest-item-claim-btn-4")
            time.sleep(0.8)

            multi_allocations: Dict[int, List[str]] = {3: [], 5: [], 6: []}
            for item_idx, qty in ((3, 2), (5, 3), (6, 2)):
                for _ in range(qty):
                    chosen = _pick_guest()
                    multi_allocations[item_idx].append(chosen)
                    guest_by_name[chosen].tap(f"guest-item-plus-{item_idx}")
                    time.sleep(0.8)

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
                timeout_s=convergence_timeout_s,
            )

            expected_shares_cents = guest_compute_local_breakdown_cents(converged_bill)
            assert sum(expected_shares_cents.values()) == expected_grand_total_cents, (
                f"Pre-payment breakdown sum mismatch: {expected_shares_cents} (expected {expected_grand_total_cents}c)"
            )
            for drv in guest_by_name.values():
                drv.eval_js(
                    f"globalThis.__QUOTA_BILL_SYNC__?.fetchBillFromCloud({json.dumps(bill_id)}).then(b => b && globalThis.__QUOTA_BILL_STORE__?.getState()?.upsertBill(b))"
                )
            time.sleep(1.0)

            for gname, drv in guest_by_name.items():
                share_txt = drv.get_node_text("guest-share-total-text")
                ui_cents = _parse_euro_cents(share_txt)
                pid = next(p["id"] for p in converged_bill["participants"] if p["name"] == gname)
                assert ui_cents == expected_shares_cents[pid], (
                    f"Guest {gname} UI share {ui_cents}c != expected {expected_shares_cents[pid]}c ({share_txt})"
                )
                drv.record("share_verified", f"UI share={share_txt} ({ui_cents}c)")

            _end_stage(
                "claims_and_conflicts",
                "conflict tests & claims converged (100% claimed)",
                st6,
                detail=f"pre-payment total={expected_grand_total_cents}c",
            )

            # Stage 7: Payments & Settlement
            st7 = _begin_stage(
                "payments_settlement",
                f"settling {num_guests} guest share(s) + Organizer",
                detail="alternating Google Pay & SEPA Instant",
            )
            pay_methods = {
                gname: ("payment-google-pay-btn" if idx % 2 == 0 else "payment-sepa-btn")
                for idx, gname in enumerate(active_guest_names)
            }
            with ThreadPoolExecutor(max_workers=min(4, num_guests)) as pool:
                def _pay_guest(gname: str) -> None:
                    drv = guest_by_name[gname]
                    btn_id = pay_methods[gname]
                    drv.tap("guest-proceed-payment-btn")
                    drv.wait_for_testid(btn_id, timeout_s=25)
                    drv.tap(btn_id)
                    drv.wait_for_testid("alert-modal-btn-0", timeout_s=30)
                    drv.tap("alert-modal-btn-0")
                    drv.wait_for_testid("summary-collected-text", timeout_s=30)
                    drv.record("payment_completed", f"Paid via {btn_id}")

                pay_futs = [pool.submit(_pay_guest, gname) for gname in active_guest_names]
                for f in as_completed(pay_futs):
                    f.result()

            wait_for_table_convergence(
                org_driver,
                bill_id,
                lambda b: sum(1 for p in b["participants"] if not p.get("isOrganizer") and p.get("status") == "paid") == num_guests,
                f"all {num_guests} guests paid on Organizer",
                timeout_s=convergence_timeout_s,
            )
            org_driver.wait_for_testid("summary-confirm-organizer-settlement-btn", timeout_s=15)
            org_driver.tap("summary-confirm-organizer-settlement-btn")

            settled_bill = wait_for_table_convergence(
                org_driver,
                bill_id,
                lambda b: b.get("status") == "settled"
                and all(p.get("status") == "paid" for p in b.get("participants", [])),
                "bill settled after Organizer confirmation",
                timeout_s=convergence_timeout_s,
            )
            time.sleep(1.5)
            _end_stage(
                "payments_settlement",
                f"all {total_diners} participants settled",
                st7,
                detail="Organizer & all guests marked paid",
                device_serial=org_slot.serial,
            )

            # Stage 8: Verification, RAM/OOM Benchmark, Cleanup & Report
            st8 = _begin_stage(
                "audit_and_cleanup",
                "verifying Phone 1 live UI, Supabase state, host RAM & logcat OOM health",
                detail=f"expected_grand_total=EUR {expected_grand_total_str}",
                device_serial=org_slot.serial,
            )
            collected_ui = org_driver.get_node_text("summary-collected-text")
            status_badge_ui = org_driver.get_node_text("summary-status-badge")
            assert expected_grand_total_str in collected_ui, (
                f"Phone 1 collected UI missing €{expected_grand_total_str}: {collected_ui}"
            )
            assert "100%" in status_badge_ui.upper() or "SETTLED" in status_badge_ui.upper() or "SALDATO" in status_badge_ui.upper(), (
                f"Phone 1 status badge not settled: {status_badge_ui}"
            )

            ui_rows = []
            ui_sum_cents = 0
            for idx in range(total_diners):
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

            assert ui_sum_cents == expected_grand_total_cents, (
                f"Phone 1 UI participant sum {ui_sum_cents}c != {expected_grand_total_cents}c"
            )

            sb_state = fetch_supabase_state(supabase_url, anon_key, bill_id)
            bill_row = sb_state["bill_row"]
            assert bill_row is not None, f"Bill {bill_id} not found in Supabase `bills` table"
            assert bill_row["status"] == "completed", f"Supabase bills.status expected 'completed', got {bill_row['status']!r}"
            assert int(round(float(bill_row["total_amount"]) * 100)) == expected_grand_total_cents, (
                f"Supabase bills.total_amount mismatch: {bill_row['total_amount']} (expected {expected_grand_total_cents}c)"
            )

            parsed_cloud = json.loads(bill_row["title"])
            cloud_bill = parsed_cloud["bill"]
            assert cloud_bill["status"] == "settled", f"Cloud JSON bill.status expected 'settled', got {cloud_bill['status']!r}"
            assert len(cloud_bill["participants"]) == total_diners, (
                f"Expected {total_diners} participants in Supabase, got {len(cloud_bill['participants'])}"
            )

            cloud_paid_sum_cents = 0
            for p in cloud_bill["participants"]:
                assert p.get("status") == "paid", f"Supabase participant {p['name']} not paid: {p}"
                p_cents = int(round(float(p.get("paidAmount", 0)) * 100))
                assert p_cents == expected_shares_cents[p["id"]], (
                    f"Supabase paidAmount mismatch for {p['name']}: {p_cents}c != {expected_shares_cents[p['id']]}c"
                )
                cloud_paid_sum_cents += p_cents
            assert cloud_paid_sum_cents == expected_grand_total_cents, (
                f"Supabase sum(paidAmount)={cloud_paid_sum_cents}c != {expected_grand_total_cents}c"
            )

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
                assert len(splits_rows) == total_diners, f"Expected {total_diners} bill_splits rows, got {len(splits_rows)}"
                for sr in splits_rows:
                    assert sr["status"] == "paid", f"bill_splits row not paid: {sr}"
                splits_sum_cents = sum(int(round(float(sr["owed_amount"]) * 100)) for sr in splits_rows)
                assert splits_sum_cents == expected_grand_total_cents, (
                    f"bill_splits sum {splits_sum_cents}c != {expected_grand_total_cents}c"
                )

            ram_benchmark = fleet.measure_fleet_ram_mb()
            memory_health = fleet.scan_logcat_memory_health()
            report["ram_benchmark"] = ram_benchmark
            report["memory_health"] = memory_health

            fleet.shutdown(keep_emulators_alive=keep_alive)
            remaining_after = list_connected_emulators(fleet.adb_exe)
            report["remaining_emulators_after_shutdown"] = remaining_after

            succeeded = True
            report["status"] = "PASSED"
            report["verification"] = {
                "phone1_ui": {
                    "collected_text": collected_ui,
                    "status_badge": status_badge_ui,
                    "participant_rows": ui_rows,
                    "sum_cents": ui_sum_cents,
                    "diff_cents": ui_sum_cents - expected_grand_total_cents,
                },
                "supabase": {
                    "bills_row_id": bill_row["id"],
                    "bills_status": bill_row["status"],
                    "bills_total_cents": int(round(float(bill_row["total_amount"]) * 100)),
                    "cloud_paid_sum_cents": cloud_paid_sum_cents,
                    "diff_cents": cloud_paid_sum_cents - expected_grand_total_cents,
                    "bill_splits_count": len(splits_rows),
                    "bill_splits_sum_cents": sum(int(round(float(sr["owed_amount"]) * 100)) for sr in splits_rows) if splits_rows else None,
                    "bill_items_count": len(sb_state["items_rows"]),
                },
            }
            report["settled_bill"] = settled_bill

            cleanup_detail = (
                f"remaining_emulators={len(remaining_after)} ({'kept alive' if keep_alive else 'shut down'}) | "
                f"host_ws={ram_benchmark.get('total_working_set_mb', '-')}MB "
                f"oom={memory_health.get('total_oom_errors', 0)} lmk={memory_health.get('total_lmk_kills', 0)}"
            )
            _end_stage(
                "audit_and_cleanup",
                "UI & Supabase verified (+/-0.00 EUR); RAM & OOM checked",
                st8,
                detail=cleanup_detail,
            )
            bus.emit(
                E2EEvent(
                    stage_id="pipeline",
                    status="PASSED",
                    step=f"{total_diners}-phone E2E pipeline PASSED",
                    detail=f"total=EUR {expected_grand_total_str}, diff=0c",
                    duration_ms=round((time.perf_counter() - run_t0) * 1000.0, 1),
                    metadata={"overhead_ms": round(bus.overhead_ms, 3)},
                    run_id=run_id,
                )
            )
            return report
        except Exception as exc:
            report["error"] = str(exc)
            failed_stage = current_stage_box[0]
            bus.emit(
                E2EEvent(
                    stage_id=failed_stage,
                    status="FAILED",
                    step="stage_failed",
                    detail=str(exc),
                    duration_ms=round((time.perf_counter() - stage_t0_box[0]) * 1000.0, 1),
                    run_id=run_id,
                )
            )
            bus.emit(
                E2EEvent(
                    stage_id="pipeline",
                    status="FAILED",
                    step="e2e pipeline failed",
                    detail=str(exc),
                    duration_ms=round((time.perf_counter() - run_t0) * 1000.0, 1),
                    metadata={"overhead_ms": round(bus.overhead_ms, 3)},
                    run_id=run_id,
                )
            )
            raise
        finally:
            if not fleet._is_shut_down and (succeeded or not keep_alive_on_fail):
                fleet.shutdown(keep_emulators_alive=bool(keep_alive and succeeded))
                report["remaining_emulators_after_shutdown"] = list_connected_emulators(fleet.adb_exe)

            report["finished_at"] = datetime.now(timezone.utc).isoformat()
            report["total_duration_s"] = round((datetime.now(timezone.utc) - start_ts).total_seconds(), 2)
            report["telemetry_overhead_ms"] = round(bus.overhead_ms, 3)
            final_snapshot = tracker.snapshot()
            report["stage_summary"] = final_snapshot["stages"]
            report["device_logs"] = {serial: drv.logs for serial, drv in drivers.items()}

            out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            write_markdown_audit_report(report, final_snapshot, bus.events, audit_md_path)
            jsonl_obs.close()
            term_obs.stop()

            if json_mode:
                if succeeded:
                    summary_payload = {
                        "run_id": run_id,
                        "status": report["status"],
                        "num_guests": num_guests,
                        "total_diners": total_diners,
                        "headless_guests": headless_guests,
                        "boot_duration_s": report.get("boot_duration_s"),
                        "install_duration_s": report.get("install_duration_s"),
                        "total_duration_s": report["total_duration_s"],
                        "telemetry_overhead_ms": report["telemetry_overhead_ms"],
                        "expected_grand_total_cents": expected_grand_total_cents,
                        "ram_benchmark": report.get("ram_benchmark"),
                        "memory_health": report.get("memory_health"),
                        "report_json_path": str(out_path),
                        "audit_md_path": str(audit_md_path),
                        "state_timeline_path": str(timeline_path),
                        "stages": final_snapshot["stages"],
                    }
                    print(json.dumps(summary_payload, indent=2), flush=True)
            else:
                mode_label = "HEADLESS GUESTS" if headless_guests else "ALL WINDOWS SHOWN"
                rb = report.get("ram_benchmark") or {}
                mh = report.get("memory_health") or {}
                print("=" * 76, flush=True)
                print("QUOTA PAY — MULTI-EMULATOR ANDROID DEPLOYMENT & E2E PIPELINE", flush=True)
                print(f"   Run ID          : {run_id}", flush=True)
                print(f"   Diners          : 1 Organizer + {num_guests} Guest(s) ({total_diners} total)", flush=True)
                print(f"   Window Mode     : {mode_label} (Guest RAM={guest_ram_mb}MB, Batch={boot_batch_size})", flush=True)
                print(f"   Final Status    : {report['status']}", flush=True)
                print(f"   Boot / Total    : {report.get('boot_duration_s', '-')}s / {report['total_duration_s']}s", flush=True)
                if rb:
                    print(
                        f"   Host Fleet RAM  : WorkingSet={rb.get('total_working_set_mb', '-')}MB "
                        f"| Private={rb.get('total_private_mb', '-')}MB ({rb.get('process_count', 0)} procs)",
                        flush=True,
                    )
                if mh:
                    print(
                        f"   Memory Health   : OOM={mh.get('total_oom_errors', 0)} | LMK kills={mh.get('total_lmk_kills', 0)}",
                        flush=True,
                    )
                print(f"   Event Overhead  : {report['telemetry_overhead_ms']:.3f}ms", flush=True)
                print("=" * 76, flush=True)
                for st in final_snapshot["stages"]:
                    dur = f"{st['duration_ms']:.1f}ms" if st.get("duration_ms") is not None else "-"
                    detail_txt = f" — {st['detail']}" if st.get("detail") else ""
                    print(
                        f"  [{st['label']}] {st['status']:<8} ({dur}) | {st['step']}{detail_txt}",
                        flush=True,
                    )
                print("-" * 76, flush=True)
                print(f"  JSON Report     : {out_path}", flush=True)
                print(f"  Markdown Audit  : {audit_md_path}", flush=True)
                print(f"  State Timeline  : {timeline_path}", flush=True)
                print("=" * 76, flush=True)
    finally:
        if ui_server is not None:
            try:
                if ui_keep_open and not os.environ.get("QUOTA_SKIP_UI_HOLD"):
                    target_stream = sys.stderr if json_mode else sys.stdout
                    print(
                        f"Dashboard kept open at {ui_url} (--ui-keep-open). Press Ctrl+C to exit.",
                        file=target_stream,
                        flush=True,
                    )
                    try:
                        while True:
                            time.sleep(0.5)
                    except KeyboardInterrupt:
                        pass
            finally:
                ui_server.stop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Multi-Phone Local Android Emulator E2E Test")
    parser.add_argument(
        "-g",
        "--guests",
        type=int,
        default=4,
        help="Number of guest emulators (1-9 with --headless-guests, 1-3 with --show-all-windows)",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--headless-guests", dest="headless_guests", action="store_true")
    mode_group.add_argument("--show-all-windows", "--all-windows", dest="headless_guests", action="store_false")
    parser.set_defaults(headless_guests=True)
    parser.add_argument(
        "--guest-ram-mb",
        type=int,
        default=None,
        help="Guest AVD RAM in MB (512-4096; default: 1024 headless, 1536 visible)",
    )
    parser.add_argument("--boot-batch-size", type=int, default=DEFAULT_BOOT_BATCH_SIZE, help="Emulators to boot per batch (1-10)")
    parser.add_argument("--prepare-snapshots", action="store_true", help="Pre-warm clean_ready snapshots and exit")
    parser.add_argument("--no-snapshot", action="store_true", help="Force cold boot without clean_ready snapshots")
    parser.add_argument("--keep-alive", action="store_true", help="Keep emulators running after E2E passes")
    parser.add_argument("--reuse-running", action="store_true", help="Reuse running fleet emulators and reset app via pm clear")
    parser.add_argument(
        "--guest-gpu",
        choices=["auto", "swiftshader_indirect", "off"],
        default="swiftshader_indirect",
        help="GPU mode for headless guest emulators",
    )
    parser.add_argument("--seed", type=int, default=int(time.time()))
    parser.add_argument("--apk", type=str, default="android/app/build/outputs/apk/debug/app-debug.apk")
    parser.add_argument("--keep-alive-on-fail", action="store_true", default=False)
    parser.add_argument(
        "--no-tui",
        action="store_true",
        help="Disable Rich live terminal board and emit timestamped plain-text steps",
    )
    parser.add_argument(
        "--ui",
        action="store_true",
        help="Start lightweight local SSE live browser dashboard on http://127.0.0.1:8765",
    )
    parser.add_argument(
        "--ui-port",
        type=int,
        default=8765,
        help="TCP port for --ui live dashboard (1-65535; default: 8765)",
    )
    parser.add_argument(
        "--ui-keep-open",
        action="store_true",
        help="Keep the --ui dashboard server alive after completion until Ctrl+C",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit final structured summary JSON to stdout",
    )
    args = parser.parse_args()

    validate_guest_config(args.guests, args.headless_guests)
    if args.ui_port < 1 or args.ui_port > 65535:
        print(
            f"ERROR: Invalid --ui-port ({args.ui_port}). Must be between 1 and 65535.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)
    resolved_guest_ram = (
        args.guest_ram_mb
        if args.guest_ram_mb is not None
        else (DEFAULT_GUEST_RAM_MB if args.headless_guests else VISIBLE_GUEST_RAM_MB)
    )
    if resolved_guest_ram < 512 or resolved_guest_ram > 4096:
        print(
            f"ERROR: Invalid --guest-ram-mb ({resolved_guest_ram}). Must be between 512 and 4096.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)
    if args.boot_batch_size < 1 or args.boot_batch_size > 10:
        print(
            f"ERROR: Invalid --boot-batch-size ({args.boot_batch_size}). Must be between 1 and 10.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)

    apk = Path(args.apk)
    if not apk.is_absolute():
        apk = PROJECT_ROOT / apk

    if args.prepare_snapshots:
        slots = build_phone_slots(args.guests, headless_guests=args.headless_guests)
        fleet = AndroidEmulatorFleet(
            project_root=PROJECT_ROOT,
            slots=slots,
            headless_guests=args.headless_guests,
            guest_ram_mb=resolved_guest_ram,
            boot_batch_size=args.boot_batch_size,
            guest_gpu_mode=args.guest_gpu,
        )
        summary = fleet.prepare_clean_snapshots(apk, batch_size=args.boot_batch_size)
        print(json.dumps(summary, indent=2), flush=True)
        return 0

    run_e2e(
        num_guests=args.guests,
        headless_guests=args.headless_guests,
        seed=args.seed,
        keep_alive_on_fail=args.keep_alive_on_fail,
        apk_path=apk,
        no_tui=args.no_tui,
        enable_ui=args.ui,
        ui_port=args.ui_port,
        ui_keep_open=args.ui_keep_open,
        json_mode=args.json,
        guest_ram_mb=resolved_guest_ram,
        boot_batch_size=args.boot_batch_size,
        no_snapshot=args.no_snapshot,
        keep_alive=args.keep_alive,
        reuse_running=args.reuse_running,
        guest_gpu=args.guest_gpu,
    )
    if not args.json:
        print(f"[e2e] ALL {1 + args.guests}-PHONE ANDROID E2E ASSERTIONS PASSED!", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


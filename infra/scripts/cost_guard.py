#!/usr/bin/env python3
"""
Quota Pay — Autonomous FinOps Monetary Circuit Breaker (infra/scripts/cost_guard.py)
Runs a background monitoring thread tracking:
  1. Spot EC2 compute uptime cost (~$0.005/hr in eu-south-1)
  2. Cumulative Gemini AI token cost from Supabase `ai_token_ledger` or `/api/ai/status`
Hard Cap Kill-Switch:
  If total monetary spend (`compute_cost_usd + token_cost_usd`) crosses the safety
  threshold (default: $5.00), immediately triggers `emergency_destroy("Budget ceiling exceeded")`
  to tear down all billable AWS infrastructure down to $0.00 cost.
"""

import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Dict, Optional

from terraform_actuator import emergency_destroy


def load_dotenv_file() -> None:
    """Loads root .env into os.environ if present."""
    root_env = Path(__file__).resolve().parent.parent.parent / ".env"
    if not root_env.exists():
        return
    try:
        for raw_line in root_env.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
    except Exception:
        pass


class CostGuardMonitor:
    """
    Background FinOps watchdog thread tracking EC2 Spot compute uptime and
    Gemini token ledger spend, enforcing the hard monetary kill-switch.
    """

    def __init__(
        self,
        max_budget_usd: float = 5.00,
        spot_hourly_rate_usd: float = 0.005,
        poll_interval_sec: float = 15.0,
        dry_run: bool = False,
    ) -> None:
        self.max_budget_usd = float(
            os.environ.get("FINOPS_HARD_CAP_USD", os.environ.get("AI_MAX_BUDGET_USD", max_budget_usd))
        )
        self.spot_hourly_rate_usd = float(
            os.environ.get("SPOT_HOURLY_RATE_USD", spot_hourly_rate_usd)
        )
        self.poll_interval_sec = poll_interval_sec
        self.dry_run = dry_run

        self.start_time_monotonic = time.monotonic()
        self.cumulative_token_cost_usd = 0.0
        self.total_tokens = 0
        self.circuit_tripped = False
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def get_compute_cost_usd(self, elapsed_hours_override: Optional[float] = None) -> float:
        """Calculates accrued EC2 Spot compute cost (~$0.005/hr)."""
        elapsed_hours = (
            elapsed_hours_override
            if elapsed_hours_override is not None
            else (time.monotonic() - self.start_time_monotonic) / 3600.0
        )
        return round(max(elapsed_hours, 0.0) * self.spot_hourly_rate_usd, 6)

    def fetch_token_ledger_cost_usd(self) -> float:
        """
        Queries Supabase `ai_token_ledger` (or the local `/api/ai/status` endpoint)
        for real-time cumulative Gemini token spend.
        """
        # 1. Try local/remote backend proxy status endpoint first
        status_url = os.environ.get("AI_STATUS_URL", "http://127.0.0.1:3000/api/ai/status")
        try:
            req = urllib.request.Request(status_url, method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    self.total_tokens = int(data.get("total_tokens", self.total_tokens))
                    self.cumulative_token_cost_usd = float(
                        data.get("estimated_cost_usd", self.cumulative_token_cost_usd)
                    )
                    return self.cumulative_token_cost_usd
        except Exception:
            pass

        # 2. Fallback: Query Supabase PostgREST table `ai_token_ledger` directly
        supabase_url = (
            os.environ.get("SUPABASE_URL")
            or os.environ.get("EXPO_PUBLIC_SUPABASE_URL")
            or ""
        ).strip()
        supabase_key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_ANON_KEY")
            or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
            or ""
        ).strip()

        if supabase_url and supabase_key:
            try:
                rest_url = f"{supabase_url.rstrip('/')}/rest/v1/ai_token_ledger?id=eq.global&select=total_tokens,estimated_cost_usd,is_paused"
                req = urllib.request.Request(
                    rest_url,
                    headers={
                        "apikey": supabase_key,
                        "Authorization": f"Bearer {supabase_key}",
                        "Accept": "application/json",
                    },
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=4) as resp:
                    if resp.status == 200:
                        rows = json.loads(resp.read().decode("utf-8"))
                        if isinstance(rows, list) and len(rows) > 0:
                            row = rows[0]
                            self.total_tokens = int(row.get("total_tokens", self.total_tokens))
                            self.cumulative_token_cost_usd = float(
                                row.get("estimated_cost_usd", self.cumulative_token_cost_usd)
                            )
            except Exception:
                pass

        return self.cumulative_token_cost_usd

    def evaluate_budget(
        self,
        simulated_token_cost_usd: Optional[float] = None,
        simulated_uptime_hours: Optional[float] = None,
    ) -> Dict[str, object]:
        """
        Computes total monetary spend (Spot compute + Gemini tokens) and triggers
        `emergency_destroy("Budget ceiling exceeded")` if spend >= max_budget_usd.
        """
        compute_cost = self.get_compute_cost_usd(simulated_uptime_hours)
        token_cost = (
            simulated_token_cost_usd
            if simulated_token_cost_usd is not None
            else self.fetch_token_ledger_cost_usd()
        )
        total_spend_usd = round(compute_cost + token_cost, 6)

        snapshot: Dict[str, object] = {
            "compute_cost_usd": compute_cost,
            "token_cost_usd": token_cost,
            "total_spend_usd": total_spend_usd,
            "max_budget_usd": self.max_budget_usd,
            "circuit_tripped": self.circuit_tripped,
        }

        if total_spend_usd >= self.max_budget_usd and not self.circuit_tripped:
            self.circuit_tripped = True
            snapshot["circuit_tripped"] = True
            destroy_res = emergency_destroy("Budget ceiling exceeded", dry_run=self.dry_run)
            snapshot["destroy_result"] = destroy_res
            self._stop_event.set()

        return snapshot

    def _monitor_loop(self) -> None:
        print(
            f"[CostGuard] Background FinOps monitor active (Hard Cap: ${self.max_budget_usd:.2f}, "
            f"Spot Rate: ${self.spot_hourly_rate_usd:.4f}/hr)"
        )
        while not self._stop_event.is_set():
            snapshot = self.evaluate_budget()
            print(f"[CostGuard] Spend telemetry: {json.dumps(snapshot)}")
            if self.circuit_tripped:
                break
            self._stop_event.wait(self.poll_interval_sec)

    def start_background_thread(self) -> threading.Thread:
        """Starts the FinOps cost guard monitor on a daemon background thread."""
        if self._thread and self._thread.is_alive():
            return self._thread
        self._thread = threading.Thread(
            target=self._monitor_loop,
            name="QuotaPay-FinOps-CostGuard",
            daemon=True,
        )
        self._thread.start()
        return self._thread

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)


if __name__ == "__main__":
    load_dotenv_file()
    is_dry = "--dry-run" in sys.argv
    is_once = "--once" in sys.argv

    guard = CostGuardMonitor(dry_run=is_dry)
    if is_once:
        result = guard.evaluate_budget()
        print(json.dumps(result, indent=2))
    else:
        thread = guard.start_background_thread()
        try:
            while thread.is_alive():
                time.sleep(1.0)
        except KeyboardInterrupt:
            guard.stop()

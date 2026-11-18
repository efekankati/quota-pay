"""
Universal Plug-and-Play Connector for external FIGARO placement solvers.
Supports switching seamlessly between `mock`, `python` callable/entrypoint,
`cli` subprocess, `http` microservice, `file`, and `raw` payload modes via `FIGARO_MODE`.
"""

from __future__ import annotations
import importlib
import json
import os
import shlex
import socket
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Union

from .figaro_adapter import FigaroPlacementAdapter
from .schema import (
    ClusterTelemetrySnapshot,
    OptimizationConstraints,
    PlacementPlan,
)

SolverCallable = Callable[[Dict[str, Any], Dict[str, Any]], Union[dict, str, Any]]


def _read_root_dotenv() -> Dict[str, str]:
    """Reads project root .env key/value pairs without mutating os.environ."""
    env_map: Dict[str, str] = {}
    root_env = Path(__file__).resolve().parent.parent.parent / ".env"
    if not root_env.exists():
        return env_map
    try:
        for raw_line in root_env.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env_map[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env_map


def _check_tcp_reachable(host: str, ports: tuple[int, ...] = (8006, 22), timeout: float = 1.0) -> bool:
    """Checks if any target TCP port on host responds within timeout seconds."""
    for port in ports:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


class FigaroConnector:
    """
    Unified connector bridging live Quota Pay cluster telemetry and optimization
    constraints to an external FIGARO placement engine.
    """

    def __init__(self) -> None:
        self._solver_callable: Optional[SolverCallable] = None

    def register_solver_callable(self, fn: Optional[SolverCallable]) -> None:
        """Registers an in-memory Python solver callback for direct integration or testing."""
        self._solver_callable = fn

    @staticmethod
    def collect_live_telemetry(proxmox_host: str = "192.168.178.125") -> ClusterTelemetrySnapshot:
        """
        Gathers live Proxmox edge reachability, AWS eu-south-1 Spot pricing,
        and FinOps token budget parameters from environment / .env / ledger.
        """
        dotenv = _read_root_dotenv()

        def _get_cfg(key: str, default: str) -> str:
            return os.environ.get(key) or dotenv.get(key) or default

        host = _get_cfg("PROXMOX_HOST", proxmox_host)
        aws_region = _get_cfg("AWS_REGION", "eu-south-1")
        spot_rate = float(_get_cfg("SPOT_HOURLY_RATE_USD", "0.005"))
        max_budget = float(_get_cfg("AI_MAX_BUDGET_USD", "5.00"))
        current_spend = 0.0

        # Probe Proxmox API (8006) / SSH (22) quickly without blocking offline callers
        proxmox_reachable = _check_tcp_reachable(host, ports=(8006, 22), timeout=1.0)

        # Best-effort fast query to local AI proxy status for live token spend
        try:
            status_url = os.environ.get("AI_STATUS_URL", "http://127.0.0.1:3000/api/ai/status")
            req = urllib.request.Request(status_url, method="GET")
            with urllib.request.urlopen(req, timeout=0.8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    current_spend = float(data.get("estimated_cost_usd", 0.0))
        except Exception:
            pass

        budget_remaining = max(round(max_budget - current_spend, 6), 0.0)

        return ClusterTelemetrySnapshot(
            proxmox_reachable=proxmox_reachable,
            proxmox_host=host,
            proxmox_available_cores=4,
            proxmox_available_memory_mb=2048,
            aws_region=aws_region,
            aws_spot_hourly_usd=spot_rate,
            current_token_spend_usd=current_spend,
            max_budget_usd=max_budget,
            budget_remaining_usd=budget_remaining,
        )

    def _solve_via_python(
        self,
        telemetry: ClusterTelemetrySnapshot,
        constraints: OptimizationConstraints,
    ) -> Any:
        if self._solver_callable is not None and "FIGARO_ENTRYPOINT" not in os.environ:
            return self._solver_callable(telemetry.model_dump(), constraints.model_dump())

        entrypoint = os.environ.get("FIGARO_ENTRYPOINT", "figaro.solver:solve")
        if ":" not in entrypoint:
            raise ValueError(
                f"Invalid FIGARO_ENTRYPOINT '{entrypoint}'. Expected 'module.path:callable_name'."
            )
        module_path, func_name = entrypoint.split(":", 1)
        module = importlib.import_module(module_path)
        solver_fn = getattr(module, func_name)
        return solver_fn(telemetry.model_dump(), constraints.model_dump())

    @staticmethod
    def _solve_via_cli(
        telemetry: ClusterTelemetrySnapshot,
        constraints: OptimizationConstraints,
    ) -> str:
        cli_cmd = os.environ.get("FIGARO_CLI_CMD", "").strip()
        if not cli_cmd:
            raise ValueError("FIGARO_CLI_CMD environment variable must be set when FIGARO_MODE=cli.")

        payload = {
            "telemetry": telemetry.model_dump(),
            "constraints": constraints.model_dump(),
        }
        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, encoding="utf-8"
            ) as tmp:
                json.dump(payload, tmp, indent=2)
                tmp_path = Path(tmp.name)

            if "{input_json}" in cli_cmd:
                formatted_cmd = cli_cmd.replace("{input_json}", str(tmp_path))
                cmd_args = shlex.split(formatted_cmd)
            else:
                cmd_args = shlex.split(cli_cmd) + [str(tmp_path)]

            proc = subprocess.run(
                cmd_args,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"FIGARO CLI failed (exit {proc.returncode}): {proc.stderr.strip()}"
                )
            return proc.stdout.strip()
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    @staticmethod
    def _solve_via_http(
        telemetry: ClusterTelemetrySnapshot,
        constraints: OptimizationConstraints,
    ) -> str:
        http_url = os.environ.get("FIGARO_HTTP_URL", "").strip()
        if not http_url:
            raise ValueError("FIGARO_HTTP_URL environment variable must be set when FIGARO_MODE=http.")

        payload = json.dumps({
            "telemetry": telemetry.model_dump(),
            "constraints": constraints.model_dump(),
        }).encode("utf-8")

        req = urllib.request.Request(
            http_url,
            data=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8")

    @staticmethod
    def _solve_via_file() -> str:
        file_path = os.environ.get("FIGARO_OUTPUT_FILE", "").strip()
        if not file_path:
            raise ValueError("FIGARO_OUTPUT_FILE environment variable must be set when FIGARO_MODE=file.")
        return Path(file_path).read_text(encoding="utf-8")

    @staticmethod
    def _select_mock_scenario(
        constraints: OptimizationConstraints,
        telemetry: ClusterTelemetrySnapshot,
    ) -> str:
        if constraints.max_hourly_budget_usd <= 0.0 or (
            constraints.prefer_edge and not constraints.allow_cloud_burst
        ):
            return "all_edge"
        if (
            not telemetry.proxmox_reachable
            and constraints.allow_cloud_burst
            and not constraints.prefer_edge
        ):
            return "cloud_burst"
        if not constraints.prefer_edge and constraints.allow_cloud_burst:
            return "cloud_burst"
        return "hybrid"

    def solve(
        self,
        constraints: Optional[OptimizationConstraints] = None,
        telemetry: Optional[ClusterTelemetrySnapshot] = None,
        mode: Optional[str] = None,
        raw_payload: Optional[Any] = None,
    ) -> PlacementPlan:
        """
        Invokes the configured FIGARO solver backend and returns a validated PlacementPlan.
        """
        active_constraints = constraints or OptimizationConstraints()
        active_telemetry = telemetry or self.collect_live_telemetry()
        resolved_mode = (mode or os.environ.get("FIGARO_MODE", "mock")).strip().lower()

        if raw_payload is not None or resolved_mode == "raw":
            if raw_payload is None:
                raise ValueError("raw_payload must be provided when mode='raw'.")
            return FigaroPlacementAdapter.parse_output(raw_payload)

        if resolved_mode in ("python", "callable"):
            raw_out = self._solve_via_python(active_telemetry, active_constraints)
            return FigaroPlacementAdapter.parse_output(raw_out)

        if resolved_mode == "cli":
            raw_out = self._solve_via_cli(active_telemetry, active_constraints)
            return FigaroPlacementAdapter.parse_output(raw_out)

        if resolved_mode == "http":
            raw_out = self._solve_via_http(active_telemetry, active_constraints)
            return FigaroPlacementAdapter.parse_output(raw_out)

        if resolved_mode == "file":
            raw_out = self._solve_via_file()
            return FigaroPlacementAdapter.parse_output(raw_out)

        if resolved_mode == "mock":
            selected_scenario = self._select_mock_scenario(active_constraints, active_telemetry)
            return FigaroPlacementAdapter.generate_mock_plan(selected_scenario)

        raise ValueError(
            f"Unsupported FIGARO_MODE '{resolved_mode}'. Expected: mock | python | cli | http | file | raw."
        )

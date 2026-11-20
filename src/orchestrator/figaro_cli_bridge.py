"""
FIGARO External CLI Interface Adapter (src/orchestrator/figaro_cli_bridge.py).

Provides a clean subprocess & JSON-over-stdin/stdout bridge between Quota Pay's
Proxmox-first 4-agent control plane and FIGARO's external CLI runtime:
  1. Invokes a configurable external FIGARO CLI binary/command, streaming structured
     JSON telemetry + operator constraints over stdin (or `{input_json}` file arg)
     and capturing stdout, stderr, exit code, and parsed placement directives.
  2. Accepts piped JSON placement directives directly from stdin or a JSON file
     (for event-driven / shell-pipeline composition with FIGARO).
  3. Translates combined natural-language operator intent + FIGARO CLI placement
     outputs into a strict `FigaroPlacementDirective` consumed by Agent 1.
  4. Falls back cleanly to deterministic Proxmox-first ($0.00/hr) synthesis when
     the external FIGARO binary is offline or unconfigured.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .figaro_adapter import FigaroPlacementAdapter
from .figaro_connector import FigaroConnector
from .schema import (
    ClusterTelemetrySnapshot,
    NodeAllocation,
    OptimizationConstraints,
    PlacementPlan,
    ServiceType,
    TargetProvider,
)


class FigaroCLIExecution(BaseModel):
    """Structured record of an external FIGARO CLI invocation or piped input."""

    model_config = ConfigDict(use_enum_values=True)

    request_id: str = Field(default_factory=lambda: f"figaro-cli-{uuid.uuid4().hex[:10]}")
    mode: str = Field(
        default="mock",
        description="Bridge transport mode: 'cli_subprocess' | 'stdin_pipe' | 'file' | 'mock'",
    )
    command: Optional[str] = None
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: float = 0.0
    fallback_reason: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class FigaroPlacementDirective(BaseModel):
    """
    Normalized input contract fed into Agent 1 (terraform_author_agent).
    Merges natural-language operator requirements with FIGARO CLI placement output.
    """

    model_config = ConfigDict(use_enum_values=True)

    directive_id: str = Field(default_factory=lambda: f"dir-{uuid.uuid4().hex[:10]}")
    source: str = Field(
        default="mock-proxmox-first",
        description="Origin of directive: 'figaro-cli' | 'figaro-stdin' | 'figaro-file' | 'mock-proxmox-first'",
    )
    prompt: str
    scenario: str = "all_edge"
    enable_aws: bool = False
    target_proxmox_node: str = "pve"
    preferred_virtualization: str = "lxc"
    requested_node_count: int = 1
    requested_cpu_cores: int = 2
    requested_memory_mb: int = 1024
    requested_disk_gb: int = 8
    requested_services: List[ServiceType] = Field(
        default_factory=lambda: [
            ServiceType.INGRESS,
            ServiceType.FRONTEND,
            ServiceType.AI_PROXY,
        ]
    )
    allowed_ports: List[int] = Field(default_factory=lambda: [80, 443])
    require_firewall: bool = True
    disable_password_auth: bool = True
    constraints: OptimizationConstraints = Field(default_factory=OptimizationConstraints)
    telemetry: ClusterTelemetrySnapshot = Field(default_factory=ClusterTelemetrySnapshot)
    placement_plan: PlacementPlan
    cli_execution: FigaroCLIExecution = Field(default_factory=FigaroCLIExecution)
    notes: List[str] = Field(default_factory=list)


def _split_cli_command(cmd_str: str) -> List[str]:
    """Splits a CLI command string safely across POSIX and Windows (stripping outer quotes on NT)."""
    tokens = shlex.split(cmd_str, posix=(os.name != "nt"))
    if os.name == "nt":
        cleaned: List[str] = []
        for tok in tokens:
            if len(tok) >= 2 and (
                (tok[0] == '"' and tok[-1] == '"') or (tok[0] == "'" and tok[-1] == "'")
            ):
                cleaned.append(tok[1:-1])
            else:
                cleaned.append(tok)
        return cleaned
    return tokens


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    """
    Extracts the last valid JSON object from CLI stdout/stdin streams, tolerating
    interleaved diagnostic log lines written before/after the JSON payload.
    """
    text = raw_text.strip()
    if not text:
        raise ValueError("Empty FIGARO CLI output; expected JSON payload.")

    # Fast path: entire stdout is a single JSON object
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Line-delimited JSON fallback (scan from bottom for final directive)
    for line in reversed(text.splitlines()):
        stripped = line.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue

    # Balanced brace scan for multi-line JSON embedded in text
    start_indices = [m.start() for m in re.finditer(r"\{", text)]
    for start in reversed(start_indices):
        candidate = text[start:]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    raise ValueError("Could not locate a valid JSON object in FIGARO CLI output.")


def parse_nl_infrastructure_intent(prompt: str, enable_aws_flag: bool = False) -> Dict[str, Any]:
    """
    Extracts explicit infrastructure sizing, virtualization, node count, service set,
    firewall intent, and AWS opt-in status from a natural-language operator prompt.
    Defaults strictly to Proxmox-first (`enable_aws = False`, `lxc`, `$0.00/hr`).
    """
    text = prompt.lower()

    # AWS is strictly opt-in unless explicitly requested via flag or unambiguous AWS burst/hybrid wording
    explicit_aws_phrases = (
        "aws",
        "ec2",
        "cloud_burst",
        "cloud burst",
        "hybrid",
        "spot instance",
        "aws spot",
        "enable_aws",
    )
    explicit_no_aws_phrases = (
        "no aws",
        "without aws",
        "proxmox only",
        "all_edge",
        "all edge",
        "edge only",
        "$0",
        "zero cloud",
        "local only",
        "proxmox-first",
    )
    wants_no_aws = any(p in text for p in explicit_no_aws_phrases)
    wants_aws = bool(enable_aws_flag) or (any(p in text for p in explicit_aws_phrases) and not wants_no_aws)

    # Extract CPU cores (e.g., "4 cores", "4 vcpu", "4 cpu")
    cpu_match = re.search(r"\b(\d{1,2})\s*(?:v?cpus?|cores?)\b", text)
    cpu_cores = max(1, min(int(cpu_match.group(1)), 32)) if cpu_match else 2

    # Extract RAM (e.g., "4096 mb", "4gb ram", "2 gb memory")
    ram_mb = 2048 if cpu_cores >= 4 else 1024
    ram_gb_match = re.search(r"\b(\d{1,3})\s*gb\s*(?:ram|mem(?:ory)?)\b", text)
    ram_mb_match = re.search(r"\b(\d{3,5})\s*mb(?:\s*(?:ram|mem(?:ory)?))?\b", text)
    if ram_gb_match:
        ram_mb = max(256, min(int(ram_gb_match.group(1)) * 1024, 65536))
    elif ram_mb_match:
        ram_mb = max(256, min(int(ram_mb_match.group(1)), 65536))

    # Extract Disk GB (e.g., "20gb disk", "16 gb storage")
    disk_match = re.search(r"\b(\d{1,4})\s*gb\s*(?:disk|storage|root|volume)\b", text)
    disk_gb = max(4, min(int(disk_match.group(1)), 1024)) if disk_match else 8

    # Extract node count (e.g., "2 nodes", "3 containers", "2 proxmox nodes")
    node_count_match = re.search(r"\b([1-5])\s*(?:proxmox\s+)?(?:nodes?|containers?|lxcs?|vms?|instances?)\b", text)
    node_count = int(node_count_match.group(1)) if node_count_match else 1

    # Extract target Proxmox node name (default: "pve")
    pve_node_match = re.search(r"\bnode\s+([a-z0-9][a-z0-9\-]{1,20})\b", text)
    target_proxmox_node = pve_node_match.group(1) if pve_node_match and pve_node_match.group(1) not in ("count", "on", "with", "for") else "pve"

    # Extract virtualization mode (default LXC; QEMU only when explicitly requested)
    if any(k in text for k in ("qemu", "full vm", "virtual machine", "cloud-init vm")):
        virtualization = "qemu"
    else:
        virtualization = "lxc"

    # Extract requested services (default all 3 Quota Pay services on Proxmox edge)
    services: List[ServiceType] = []
    if any(k in text for k in ("ingress", "caddy", "reverse proxy", "gateway")):
        services.append(ServiceType.INGRESS)
    if any(k in text for k in ("frontend", "web", "ui", "spa")):
        services.append(ServiceType.FRONTEND)
    if any(k in text for k in ("ai-proxy", "ai proxy", "gemini", "backend", "api")):
        services.append(ServiceType.AI_PROXY)
    if not services:
        services = [ServiceType.INGRESS, ServiceType.FRONTEND, ServiceType.AI_PROXY]

    # Ports requested
    allowed_ports = [80, 443]
    if ServiceType.AI_PROXY in services and any(k in text for k in ("3000", "expose api", "direct api")):
        allowed_ports.append(3000)

    # Scenario classification (Proxmox-first!)
    if wants_aws:
        if any(k in text for k in ("cloud_burst", "cloud burst", "full aws", "aws only", "all cloud")):
            scenario = "cloud_burst"
        else:
            scenario = "hybrid"
    else:
        scenario = "all_edge"

    return {
        "scenario": scenario,
        "enable_aws": wants_aws,
        "target_proxmox_node": target_proxmox_node,
        "preferred_virtualization": virtualization,
        "requested_node_count": node_count,
        "requested_cpu_cores": cpu_cores,
        "requested_memory_mb": ram_mb,
        "requested_disk_gb": disk_gb,
        "requested_services": services,
        "allowed_ports": sorted(set(allowed_ports)),
    }


class FigaroCLIBridge:
    """
    CLI communication adapter connecting FIGARO's external CLI runtime to Quota Pay's
    Proxmox-first multi-agent pipeline.
    """

    def __init__(
        self,
        cli_command: Optional[str] = None,
        timeout_sec: int = 60,
        project_root: Optional[Path] = None,
    ) -> None:
        self.cli_command = (cli_command or os.environ.get("FIGARO_CLI_CMD", "")).strip() or None
        self.timeout_sec = timeout_sec
        self.project_root = (
            Path(project_root).resolve()
            if project_root
            else Path(__file__).resolve().parent.parent.parent
        )
        self.connector = FigaroConnector()

    def build_cli_request_payload(
        self,
        prompt: str,
        telemetry: ClusterTelemetrySnapshot,
        constraints: OptimizationConstraints,
        enable_aws: bool = False,
    ) -> Dict[str, Any]:
        """Constructs the canonical JSON payload streamed to FIGARO over stdin."""
        return {
            "protocol": "quota-figaro-cli/v1",
            "request_id": f"figaro-req-{uuid.uuid4().hex[:10]}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "prompt": prompt,
            "proxmox_first": True,
            "enable_aws": enable_aws,
            "telemetry": telemetry.model_dump(),
            "constraints": constraints.model_dump(),
        }

    def invoke_cli(
        self,
        request_payload: Dict[str, Any],
        cli_command: Optional[str] = None,
    ) -> tuple[Optional[Dict[str, Any]], FigaroCLIExecution]:
        """
        Executes an external FIGARO CLI command, passing JSON over stdin (and optionally
        expanding `{input_json}` into a temporary JSON file path), returning parsed JSON
        plus full stdout/stderr/exit_code execution metadata.
        """
        cmd_str = (cli_command or self.cli_command or "").strip()
        if not cmd_str:
            return None, FigaroCLIExecution(
                request_id=request_payload["request_id"],
                mode="mock",
                exit_code=0,
                fallback_reason="No external FIGARO CLI command configured; using Proxmox-first local mock.",
            )

        tmp_path: Optional[Path] = None
        started = time.perf_counter()
        try:
            payload_json = json.dumps(request_payload, indent=2)
            if "{input_json}" in cmd_str:
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".json", delete=False, encoding="utf-8"
                ) as tmp:
                    tmp.write(payload_json)
                    tmp_path = Path(tmp.name)
                expanded = cmd_str.replace("{input_json}", str(tmp_path))
                cmd_args = _split_cli_command(expanded)
            else:
                cmd_args = _split_cli_command(cmd_str)

            proc = subprocess.run(
                cmd_args,
                input=payload_json,
                capture_output=True,
                text=True,
                timeout=self.timeout_sec,
                check=False,
                cwd=str(self.project_root),
            )
            duration_ms = round((time.perf_counter() - started) * 1000.0, 2)
            exec_meta = FigaroCLIExecution(
                request_id=request_payload["request_id"],
                mode="cli_subprocess",
                command=cmd_str,
                exit_code=proc.returncode,
                stdout=proc.stdout.strip(),
                stderr=proc.stderr.strip(),
                duration_ms=duration_ms,
            )
            if proc.returncode != 0:
                exec_meta.fallback_reason = (
                    f"FIGARO CLI exited with code {proc.returncode}: {proc.stderr.strip()[:200]}"
                )
                return None, exec_meta

            parsed = _extract_json_object(proc.stdout)
            return parsed, exec_meta
        except FileNotFoundError as exc:
            duration_ms = round((time.perf_counter() - started) * 1000.0, 2)
            return None, FigaroCLIExecution(
                request_id=request_payload["request_id"],
                mode="cli_subprocess",
                command=cmd_str,
                exit_code=127,
                stderr=str(exc),
                duration_ms=duration_ms,
                fallback_reason=f"FIGARO CLI binary not found ({exc}); falling back to Proxmox-first mock.",
            )
        except subprocess.TimeoutExpired:
            duration_ms = round((time.perf_counter() - started) * 1000.0, 2)
            return None, FigaroCLIExecution(
                request_id=request_payload["request_id"],
                mode="cli_subprocess",
                command=cmd_str,
                exit_code=124,
                stderr=f"FIGARO CLI timed out after {self.timeout_sec}s",
                duration_ms=duration_ms,
                fallback_reason=f"FIGARO CLI timed out after {self.timeout_sec}s; falling back to local mock.",
            )
        except Exception as exc:
            duration_ms = round((time.perf_counter() - started) * 1000.0, 2)
            return None, FigaroCLIExecution(
                request_id=request_payload["request_id"],
                mode="cli_subprocess",
                command=cmd_str,
                exit_code=1,
                stderr=str(exc),
                duration_ms=duration_ms,
                fallback_reason=f"Failed parsing FIGARO CLI output ({exc}); falling back to local mock.",
            )
        finally:
            if tmp_path and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    @staticmethod
    def parse_stdin_or_file(
        stdin_text: Optional[str] = None,
        file_path: Optional[Path] = None,
    ) -> tuple[Optional[Dict[str, Any]], Optional[FigaroCLIExecution]]:
        """Reads a piped FIGARO CLI JSON placement payload from stdin or a file."""
        if file_path is not None:
            raw = Path(file_path).read_text(encoding="utf-8")
            parsed = _extract_json_object(raw)
            return parsed, FigaroCLIExecution(
                mode="file",
                command=f"file:{file_path}",
                exit_code=0,
                stdout=raw.strip(),
            )
        if stdin_text is not None and stdin_text.strip():
            parsed = _extract_json_object(stdin_text)
            return parsed, FigaroCLIExecution(
                mode="stdin_pipe",
                command="stdin",
                exit_code=0,
                stdout=stdin_text.strip(),
            )
        return None, None

    def _build_proxmox_first_mock_plan(
        self,
        intent: Dict[str, Any],
        telemetry: ClusterTelemetrySnapshot,
    ) -> PlacementPlan:
        """Synthesizes a Proxmox-first placement plan ($0.00/hr default)."""
        enable_aws = bool(intent["enable_aws"])
        scenario = intent["scenario"]
        pve_node = intent["target_proxmox_node"]
        virt = intent["preferred_virtualization"]
        cores = intent["requested_cpu_cores"]
        mem_mb = intent["requested_memory_mb"]
        disk_gb = intent["requested_disk_gb"]
        services = intent["requested_services"]
        allowed_ports = intent["allowed_ports"]
        node_count = intent["requested_node_count"]

        if not enable_aws:
            nodes: Dict[str, NodeAllocation] = {}
            if node_count == 1:
                nodes["edge-primary"] = NodeAllocation(
                    target_provider=TargetProvider.PROXMOX,
                    target_node=pve_node,
                    cpu_cores=cores,
                    memory_mb=mem_mb,
                    disk_gb=disk_gb,
                    virtualization_type=virt,
                    enable_firewall=True,
                    allowed_ports=allowed_ports,
                    services=services,
                    compose_target="docker-compose.edge.yml",
                    metadata={"role": "proxmox-primary-edge", "cost_usd_hourly": 0.0},
                )
            else:
                # Distribute services across N Proxmox edge nodes cleanly
                svc_list = list(services)
                for idx in range(node_count):
                    assigned = [svc_list[idx % len(svc_list)]] if idx > 0 else svc_list
                    if node_count == 2 and len(svc_list) >= 2:
                        assigned = (
                            [s for s in svc_list if s != ServiceType.AI_PROXY]
                            if idx == 0
                            else [ServiceType.AI_PROXY]
                        )
                        if not assigned:
                            assigned = [svc_list[0]]
                    nodes[f"edge-node-{idx + 1:02d}"] = NodeAllocation(
                        target_provider=TargetProvider.PROXMOX,
                        target_node=pve_node,
                        cpu_cores=cores,
                        memory_mb=mem_mb,
                        disk_gb=disk_gb,
                        virtualization_type=virt,
                        enable_firewall=True,
                        allowed_ports=allowed_ports,
                        services=assigned,
                        compose_target="docker-compose.edge.yml",
                        metadata={"role": f"proxmox-edge-{idx + 1:02d}", "cost_usd_hourly": 0.0},
                    )
            return PlacementPlan(
                scenario="all_edge",
                nodes=nodes,
                metadata={
                    "algorithm": "FIGARO-ProxmoxFirst-LocalMock",
                    "estimated_cost_usd_hourly": 0.0,
                    "estimated_latency_ms": 2.0,
                    "aws_enabled": False,
                },
            )

        # Opt-in AWS hybrid / cloud_burst
        plan = FigaroPlacementAdapter.generate_mock_plan(scenario=scenario)
        for node in plan.nodes.values():
            if node.target_provider == TargetProvider.PROXMOX or node.target_provider == "proxmox":
                node.target_node = pve_node
                node.virtualization_type = virt
                node.disk_gb = disk_gb
                node.enable_firewall = True
                node.allowed_ports = allowed_ports
        plan.metadata["aws_enabled"] = True
        plan.metadata["aws_region"] = telemetry.aws_region
        return plan

    def resolve_directive(
        self,
        prompt: str,
        cli_command: Optional[str] = None,
        stdin_text: Optional[str] = None,
        figaro_file: Optional[Path] = None,
        enable_aws: bool = False,
        telemetry: Optional[ClusterTelemetrySnapshot] = None,
        strict_cli: bool = False,
    ) -> FigaroPlacementDirective:
        """
        End-to-end FIGARO CLI bridge:
          1. Collects cluster telemetry & extracts operator NL constraints.
          2. Accepts piped stdin/file payload OR invokes external FIGARO CLI subprocess.
          3. Normalizes placement into `PlacementPlan` + `FigaroPlacementDirective`.
          4. Enforces Proxmox-first defaults unless AWS was explicitly requested.
        """
        active_telemetry = telemetry or self.connector.collect_live_telemetry()
        intent = parse_nl_infrastructure_intent(prompt, enable_aws_flag=enable_aws)

        constraints = OptimizationConstraints(
            max_hourly_budget_usd=0.0 if not intent["enable_aws"] else max(active_telemetry.aws_spot_hourly_usd, 0.015),
            max_latency_ms=10.0 if not intent["enable_aws"] else 35.0,
            prefer_edge=not (intent["scenario"] == "cloud_burst"),
            allow_cloud_burst=intent["enable_aws"],
            required_services=intent["requested_services"],
            objective="proxmox_first_zero_cloud_cost" if not intent["enable_aws"] else "min_latency_and_cost",
        )

        notes: List[str] = []
        raw_payload: Optional[Dict[str, Any]] = None
        cli_exec: Optional[FigaroCLIExecution] = None
        source = "mock-proxmox-first"

        # 1. Check piped stdin or file input first
        if figaro_file is not None or (stdin_text is not None and stdin_text.strip()):
            raw_payload, cli_exec = self.parse_stdin_or_file(
                stdin_text=stdin_text,
                file_path=figaro_file,
            )
            source = "figaro-file" if figaro_file is not None else "figaro-stdin"
        else:
            # 2. Otherwise invoke configured external FIGARO CLI command
            request_payload = self.build_cli_request_payload(
                prompt=prompt,
                telemetry=active_telemetry,
                constraints=constraints,
                enable_aws=intent["enable_aws"],
            )
            raw_payload, cli_exec = self.invoke_cli(request_payload, cli_command=cli_command)
            if raw_payload is not None:
                source = "figaro-cli"
            elif strict_cli and (cli_command or self.cli_command):
                raise RuntimeError(
                    f"FIGARO CLI failed in strict mode: {cli_exec.fallback_reason or cli_exec.stderr}"
                )

        if raw_payload is not None:
            # Support nested {"directive": ...} or {"decision": ...} envelopes as well as direct payloads
            unwrapped = raw_payload.get("decision") or raw_payload.get("directive") or raw_payload
            plan = FigaroPlacementAdapter.parse_output(unwrapped)
            # Apply Proxmox sizing/hardening fields when present in raw payload
            raw_nodes_map = unwrapped.get("nodes") if isinstance(unwrapped.get("nodes"), dict) else {}
            raw_allocs_by_id = {
                a.get("node_id"): a
                for a in (unwrapped.get("allocations") or [])
                if isinstance(a, dict) and a.get("node_id")
            }
            for node_id, node in plan.nodes.items():
                src_node = raw_nodes_map.get(node_id) or raw_allocs_by_id.get(node_id) or {}
                if "disk_gb" in src_node:
                    node.disk_gb = int(src_node["disk_gb"])
                if "virtualization_type" in src_node:
                    node.virtualization_type = str(src_node["virtualization_type"])
                elif node.target_provider == TargetProvider.PROXMOX or node.target_provider == "proxmox":
                    node.virtualization_type = intent["preferred_virtualization"]
                if "enable_firewall" in src_node:
                    node.enable_firewall = bool(src_node["enable_firewall"])
                if "allowed_ports" in src_node and isinstance(src_node["allowed_ports"], list):
                    node.allowed_ports = [int(p) for p in src_node["allowed_ports"]]

            # Sync directive expectations with FIGARO CLI authoritative placement
            pve_nodes = [
                n for n in plan.nodes.values()
                if (n.target_provider == TargetProvider.PROXMOX or n.target_provider == "proxmox")
            ]
            aws_nodes = [
                n for n in plan.nodes.values()
                if (n.target_provider == TargetProvider.AWS or n.target_provider == "aws")
            ]
            if aws_nodes and not intent["enable_aws"]:
                notes.append(
                    "FIGARO CLI returned AWS allocation(s) while enable_aws=False; "
                    "Agent 2 policy guard will audit and enforce Proxmox-first unless AWS is opted in."
                )
            primary = pve_nodes[0] if pve_nodes else next(iter(plan.nodes.values()))
            requested_cpu = primary.cpu_cores
            requested_mem = primary.memory_mb
            requested_disk = primary.disk_gb
            requested_count = len(plan.nodes)
            requested_svcs = sorted(
                {
                    s if isinstance(s, ServiceType) else ServiceType(s)
                    for n in plan.nodes.values()
                    for s in n.services
                },
                key=lambda s: s.value,
            )
            target_pve = primary.target_node or intent["target_proxmox_node"]
            pref_virt = primary.virtualization_type
            scenario = plan.scenario
        else:
            plan = self._build_proxmox_first_mock_plan(intent, active_telemetry)
            if cli_exec and cli_exec.fallback_reason:
                notes.append(cli_exec.fallback_reason)
            requested_cpu = intent["requested_cpu_cores"]
            requested_mem = intent["requested_memory_mb"]
            requested_disk = intent["requested_disk_gb"]
            requested_count = intent["requested_node_count"]
            requested_svcs = intent["requested_services"]
            target_pve = intent["target_proxmox_node"]
            pref_virt = intent["preferred_virtualization"]
            scenario = plan.scenario

        return FigaroPlacementDirective(
            source=source,
            prompt=prompt,
            scenario=scenario,
            enable_aws=intent["enable_aws"],
            target_proxmox_node=target_pve,
            preferred_virtualization=pref_virt,
            requested_node_count=requested_count,
            requested_cpu_cores=requested_cpu,
            requested_memory_mb=requested_mem,
            requested_disk_gb=requested_disk,
            requested_services=requested_svcs,
            allowed_ports=intent["allowed_ports"],
            require_firewall=True,
            disable_password_auth=True,
            constraints=constraints,
            telemetry=active_telemetry,
            placement_plan=plan,
            cli_execution=cli_exec or FigaroCLIExecution(mode="mock"),
            notes=notes,
        )


def read_piped_stdin_if_present() -> Optional[str]:
    """Reads non-interactive stdin stream if piped from an upstream FIGARO CLI process."""
    try:
        if sys.stdin is not None and not sys.stdin.isatty():
            data = sys.stdin.read()
            return data if data.strip() else None
    except Exception:
        pass
    return None

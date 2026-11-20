"""
Typed State & Artifact Schemas for the Proxmox-First 4-Agent Terraform Control Plane.
Compatible with LangGraph `StateGraph` and direct JSON/Markdown audit serialization.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, TypedDict

from pydantic import BaseModel, ConfigDict, Field


class PolicyViolation(BaseModel):
    """Structured pre-deployment policy or intent mismatch emitted by Agent 2."""

    model_config = ConfigDict(use_enum_values=True)

    code: str
    severity: Literal["error", "warning"] = "error"
    category: Literal[
        "intent_alignment",
        "proxmox_constraints",
        "security",
        "aws_opt_in_guard",
        "terraform_validation",
    ]
    field: str
    expected: Any = None
    actual: Any = None
    message: str
    remediation_hint: str


class PlanDiffSummary(BaseModel):
    """Summary of planned Terraform changes extracted from plan JSON or static tfvars preview."""

    model_config = ConfigDict(use_enum_values=True)

    source: Literal["terraform_show_json", "static_tfvars_preview"] = "static_tfvars_preview"
    terraform_validate_passed: bool = False
    resources_to_create: List[str] = Field(default_factory=list)
    resources_to_update: List[str] = Field(default_factory=list)
    resources_to_destroy: List[str] = Field(default_factory=list)
    proxmox_resources_planned: List[str] = Field(default_factory=list)
    aws_resources_planned: List[str] = Field(default_factory=list)
    raw_plan_excerpt: str = ""


class FunctionalCheckResult(BaseModel):
    """Single end-to-end functional verification probe executed by Agent 3."""

    model_config = ConfigDict(use_enum_values=True)

    name: str
    endpoint: str
    passed: bool
    status_code: Optional[int] = None
    latency_ms: Optional[float] = None
    detail: str = ""


class AuditFinding(BaseModel):
    """Post-deployment capability, security, or performance finding emitted by Agent 4."""

    model_config = ConfigDict(use_enum_values=True)

    finding_id: str
    pillar: Literal["capability", "security", "performance"]
    severity: Literal["critical", "high", "medium", "low"]
    resource: str
    issue: str
    expected: Any = None
    observed: Any = None
    auto_remediable: bool = False
    remediated: bool = False


class RemediationAction(BaseModel):
    """Concrete security or performance auto-remediation executed by Agent 4."""

    model_config = ConfigDict(use_enum_values=True)

    finding_id: str
    target_file: str
    action_type: Literal["security_hardening", "performance_tuning", "capability_alignment"]
    before_value: Any = None
    after_value: Any = None
    applied: bool = False
    re_verified: bool = False
    detail: str = ""


class AgentLogEntry(BaseModel):
    """Chronological structured trace entry logged by each agent."""

    model_config = ConfigDict(use_enum_values=True)

    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    agent: str
    phase: str
    status: Literal["started", "passed", "rejected", "remediated", "failed", "skipped"]
    reasoning: str
    details: Dict[str, Any] = Field(default_factory=dict)


class AgentPipelineConfig(BaseModel):
    """Runtime configuration controlling the 4-agent supervisor pipeline."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    project_root: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parent.parent.parent
    )
    infra_dir: Optional[Path] = None
    docker_dir: Optional[Path] = None
    report_dir: Optional[Path] = None
    generated_hcl_filename: str = "agent_generated.tf"
    tfvars_filename: str = "terraform.tfvars.json"
    execution_mode: Literal["dry-run", "live"] = "dry-run"
    enable_aws: bool = False
    use_existing_edge: bool = False
    max_retries: int = Field(default=3, ge=0, le=10)
    nested_vtx_available: bool = False
    proxmox_host: str = "192.168.178.125"
    edge_ip: str = "192.168.178.128"
    cloud_ip: str = "15.160.125.0"
    edge_container_id: int = 101
    latency_threshold_ms: float = 250.0
    max_memory_utilization_pct: float = 80.0
    max_cpu_utilization_pct: float = 85.0
    use_live_llm: bool = False
    strict_figaro_cli: bool = False
    auto_remediate: bool = True

    def resolved_infra_dir(self) -> Path:
        return (self.infra_dir or (self.project_root / "infra")).resolve()

    def resolved_docker_dir(self) -> Path:
        return (self.docker_dir or (self.project_root / "docker")).resolve()

    def resolved_report_dir(self) -> Path:
        return (self.report_dir or (self.project_root / "reports")).resolve()


class AgentState(TypedDict, total=False):
    """
    Shared LangGraph StateGraph state threaded through the 4-agent pipeline:
      FIGARO CLI Bridge -> Agent 1 (Author) <-> Agent 2 (Policy Guard) ->
      Agent 3 (Deploy & Verify Runner) -> Agent 4 (Post-Deploy Auditor & Remediator) -> Report
    """

    run_id: str
    started_at: str
    prompt: str
    figaro_cmd: Optional[str]
    figaro_stdin: Optional[str]
    figaro_file: Optional[str]
    config: Dict[str, Any]

    # Stage 0: FIGARO CLI Bridge output
    directive: Dict[str, Any]
    figaro_cli_execution: Dict[str, Any]

    # Stage 1: Agent 1 — Terraform Authoring outputs
    retry_count: int
    max_retries: int
    authored_hcl_path: str
    authored_hcl_content: str
    tfvars_path: str
    tfvars_data: Dict[str, Any]
    placement_env_path: str
    author_notes: List[str]

    # Stage 2: Agent 2 — Prompt & Policy Auditor outputs
    guard_approved: bool
    policy_violations: List[Dict[str, Any]]
    policy_feedback: List[Dict[str, Any]]
    policy_history: List[Dict[str, Any]]
    plan_diff: Dict[str, Any]

    # Stage 3: Agent 3 — Real-Environment Automation & Verification outputs
    deploy_succeeded: bool
    terraform_apply_output: str
    live_ips: Dict[str, str]
    functional_checks: List[Dict[str, Any]]
    observed_runtime_telemetry: Dict[str, Any]

    # Stage 4: Agent 4 — Post-Deployment Security, Performance & Compliance Auditor outputs
    audit_passed: bool
    audit_findings: List[Dict[str, Any]]
    remediations_applied: List[Dict[str, Any]]
    post_remediation_findings: List[Dict[str, Any]]

    # Global orchestration audit trail & report locations
    status: str
    agent_logs: List[Dict[str, Any]]
    report_json_path: str
    report_md_path: str

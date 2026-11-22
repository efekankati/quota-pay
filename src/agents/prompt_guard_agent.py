"""
Agent 2 — Prompt & Policy Auditor (`prompt_guard_agent`).

Pre-execution gatekeeper auditing:
  1. Original operator prompt + FIGARO CLI placement constraints vs Agent 1's HCL & tfvars
  2. Real `terraform validate` and (when Proxmox/AWS APIs are reachable) `terraform plan` JSON
  3. Proxmox environment constraints (nested VT-x / KVM fallback, node `pve`)
  4. Hardcoded secrets, network/port exposure, firewall rules, and AWS opt-in gate
Rejects unsafe or misaligned configurations with structured diff feedback and routes
back to Agent 1 for self-correction (`max_retries = 3`).
"""

from __future__ import annotations

import socket
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from src.orchestrator.actuator import TerraformActuator

from .rubrics import evaluate_pre_deploy_rubric
from .state import (
    AgentLogEntry,
    AgentPipelineConfig,
    AgentState,
    PlanDiffSummary,
    PolicyViolation,
)
from .telemetry import noop_emit


def _is_tcp_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _summarize_plan_from_json(plan_json: Dict[str, Any], validate_ok: bool, raw_stdout: str) -> PlanDiffSummary:
    create_list: List[str] = []
    update_list: List[str] = []
    destroy_list: List[str] = []
    pve_list: List[str] = []
    aws_list: List[str] = []

    for rc in plan_json.get("resource_changes", []):
        addr = str(rc.get("address", ""))
        rtype = str(rc.get("type", ""))
        actions = (rc.get("change") or {}).get("actions", [])
        if "create" in actions:
            create_list.append(addr)
        if "update" in actions:
            update_list.append(addr)
        if "delete" in actions:
            destroy_list.append(addr)
        if rtype.startswith("proxmox_"):
            pve_list.append(addr)
        elif rtype.startswith("aws_"):
            aws_list.append(addr)

    return PlanDiffSummary(
        source="terraform_show_json",
        terraform_validate_passed=validate_ok,
        resources_to_create=create_list,
        resources_to_update=update_list,
        resources_to_destroy=destroy_list,
        proxmox_resources_planned=pve_list,
        aws_resources_planned=aws_list,
        raw_plan_excerpt=raw_stdout[:1200],
    )


def _summarize_static_plan_preview(tfvars_data: Dict[str, Any], validate_ok: bool) -> PlanDiffSummary:
    """Synthesizes deterministic resource diff preview when offline from Proxmox API."""
    create_list: List[str] = []
    pve_list: List[str] = []
    aws_list: List[str] = []
    enable_aws = bool(tfvars_data.get("enable_aws", False))

    for node_id, spec in (tfvars_data.get("placement_plan") or {}).items():
        if not isinstance(spec, dict):
            continue
        provider = str(spec.get("target_provider", "")).lower()
        if provider == "proxmox":
            virt = str(spec.get("virtualization_type", "lxc")).lower()
            res_name = (
                f'module.proxmox_nodes["{node_id}"].proxmox_virtual_environment_container.edge_lxc[0]'
                if virt == "lxc"
                else f'module.proxmox_nodes["{node_id}"].proxmox_virtual_environment_vm.edge_node[0]'
            )
            create_list.append(res_name)
            pve_list.append(res_name)
            if bool(spec.get("enable_firewall", True)):
                fw_opt = f'module.proxmox_nodes["{node_id}"].proxmox_virtual_environment_firewall_options.edge_fw_options[0]'
                fw_rules = f'module.proxmox_nodes["{node_id}"].proxmox_virtual_environment_firewall_rules.edge_fw_rules[0]'
                create_list.extend([fw_opt, fw_rules])
                pve_list.extend([fw_opt, fw_rules])
        elif provider == "aws" and enable_aws:
            res_name = f'module.aws_spot_nodes["{node_id}"].aws_instance.spot_node'
            create_list.append(res_name)
            aws_list.append(res_name)

    if aws_list:
        shared_aws = [
            "aws_vpc.quota_vpc[0]",
            "aws_subnet.quota_public_subnet[0]",
            "aws_internet_gateway.quota_igw[0]",
            "aws_security_group.quota_sg[0]",
        ]
        create_list.extend(shared_aws)
        aws_list.extend(shared_aws)

    return PlanDiffSummary(
        source="static_tfvars_preview",
        terraform_validate_passed=validate_ok,
        resources_to_create=create_list,
        proxmox_resources_planned=pve_list,
        aws_resources_planned=aws_list,
        raw_plan_excerpt=(
            f"Static preview (Proxmox API offline): {len(pve_list)} Proxmox resource(s), "
            f"{len(aws_list)} AWS resource(s), enable_aws={enable_aws}."
        ),
    )


class PromptGuardAgent:
    """Agent 2: Pre-execution policy, capability alignment, and Terraform plan auditor."""

    NAME = "prompt_guard_agent"

    def __init__(
        self,
        config: AgentPipelineConfig,
        emit: Optional[Callable[..., Any]] = None,
    ) -> None:
        self.config = config
        self.emit = emit or noop_emit
        self.actuator = TerraformActuator(project_root=config.project_root)
        self.actuator.infra_dir = config.resolved_infra_dir()
        self.actuator.docker_dir = config.resolved_docker_dir()

    def _collect_hcl_files(self, state: AgentState) -> Dict[str, str]:
        hcl_files: Dict[str, str] = {}
        infra_dir = self.config.resolved_infra_dir()
        candidates = [
            Path(state["authored_hcl_path"]) if state.get("authored_hcl_path") else infra_dir / self.config.generated_hcl_filename,
            infra_dir / "main.tf",
            infra_dir / "variables.tf",
            infra_dir / "modules" / "proxmox_node" / "main.tf",
            infra_dir / "modules" / "proxmox_node" / "cloud_init.yaml",
        ]
        for path in candidates:
            if path.exists() and path.is_file():
                hcl_files[path.name] = path.read_text(encoding="utf-8", errors="ignore")
        return hcl_files

    def run(self, state: AgentState) -> AgentState:
        """Audits authored HCL + tfvars + terraform validate/plan before deployment."""
        started = time.perf_counter()
        directive = state.get("directive") or {}
        tfvars_data = state.get("tfvars_data") or {}
        retry_count = int(state.get("retry_count", 0))
        max_retries = int(state.get("max_retries", self.config.max_retries))
        logs = list(state.get("agent_logs") or [])
        policy_history = list(state.get("policy_history") or [])

        # 1. Always run real `terraform validate`
        self.emit("RUNNING", "running terraform validate", retry_count=retry_count)
        val_res = self.actuator.validate()
        validate_ok = bool(val_res.get("success", False))

        # 2. Attempt live `terraform plan -out + show -json` if live mode & Proxmox API reachable
        self.emit("RUNNING", "evaluating terraform plan diff & policy rubrics", retry_count=retry_count)
        plan_json: Optional[Dict[str, Any]] = None
        plan_diff: PlanDiffSummary
        if (
            validate_ok
            and self.config.execution_mode == "live"
            and _is_tcp_open(self.config.proxmox_host, 8006, timeout=1.2)
        ):
            pj_res = self.actuator.plan_json(var_file=self.config.tfvars_filename)
            if pj_res.get("success") and isinstance(pj_res.get("plan_json"), dict):
                plan_json = pj_res["plan_json"]
                plan_diff = _summarize_plan_from_json(plan_json, validate_ok, pj_res.get("stdout", ""))
            else:
                plan_diff = _summarize_static_plan_preview(tfvars_data, validate_ok)
        else:
            plan_diff = _summarize_static_plan_preview(tfvars_data, validate_ok)

        # 3. Evaluate complete pre-deployment policy & alignment rubric
        hcl_files = self._collect_hcl_files(state)
        violations: List[PolicyViolation] = evaluate_pre_deploy_rubric(
            directive=directive,
            tfvars_data=tfvars_data,
            hcl_files=hcl_files,
            plan_json=plan_json,
            config=self.config,
        )

        if not validate_ok:
            violations.insert(
                0,
                PolicyViolation(
                    code="TERRAFORM_VALIDATE_FAILED",
                    severity="error",
                    category="terraform_validation",
                    field="infra/",
                    expected="terraform validate exit code 0",
                    actual=val_res.get("stderr") or val_res.get("stdout"),
                    message=f"terraform validate failed: {val_res.get('stderr', '')[:240]}",
                    remediation_hint="Fix HCL syntax or variable types in agent_generated.tf / terraform.tfvars.json.",
                ),
            )

        errors = [v for v in violations if v.severity == "error"]
        approved = len(errors) == 0

        violation_dicts = [v.model_dump() for v in violations]
        policy_history.append(
            {
                "attempt": retry_count,
                "approved": approved,
                "error_count": len(errors),
                "violations": violation_dicts,
            }
        )

        next_retry = retry_count if approved else retry_count + 1
        if approved:
            reasoning = (
                f"Pre-deployment audit PASSED on revision {retry_count}: terraform validate OK, "
                f"Proxmox constraints & security guardrails satisfied "
                f"({len(plan_diff.proxmox_resources_planned)} Proxmox, {len(plan_diff.aws_resources_planned)} AWS planned)."
            )
            status_val = "passed"
            pipeline_status = state.get("status", "running")
        else:
            codes = ", ".join(sorted({v.code for v in errors}))
            if next_retry <= max_retries:
                reasoning = (
                    f"Pre-deployment audit REJECTED revision {retry_count} with {len(errors)} error(s) "
                    f"[{codes}]. Routing structured diff feedback back to Agent 1 (retry {next_retry}/{max_retries})."
                )
                pipeline_status = "retrying_author"
            else:
                reasoning = (
                    f"Pre-deployment audit BLOCKED execution after exhausting retries ({max_retries}): [{codes}]."
                )
                pipeline_status = "blocked_by_policy_guard"
            status_val = "rejected"

        logs.append(
            AgentLogEntry(
                agent=self.NAME,
                phase=f"policy_audit_rev_{retry_count}",
                status=status_val,
                reasoning=reasoning,
                details={
                    "approved": approved,
                    "error_count": len(errors),
                    "violation_codes": [v.code for v in errors],
                    "plan_source": plan_diff.source,
                },
            ).model_dump()
        )

        duration_ms = round((time.perf_counter() - started) * 1000.0, 2)
        if approved:
            self.emit(
                "PASSED",
                "pre-deployment policy approved",
                detail=(
                    f"{len(plan_diff.proxmox_resources_planned)} Proxmox, "
                    f"{len(plan_diff.aws_resources_planned)} AWS planned"
                ),
                duration_ms=duration_ms,
                retry_count=next_retry,
            )
        elif next_retry <= max_retries:
            self.emit(
                "RETRYING",
                "policy rejected; routing diff to Agent 1",
                detail=", ".join(sorted({v.code for v in errors})),
                duration_ms=duration_ms,
                retry_count=next_retry,
            )
        else:
            self.emit(
                "FAILED",
                "policy blocked after max retries",
                detail=", ".join(sorted({v.code for v in errors})),
                duration_ms=duration_ms,
                retry_count=next_retry,
            )

        return {
            **state,
            "guard_approved": approved,
            "retry_count": next_retry,
            "policy_violations": violation_dicts,
            "policy_feedback": [] if approved else [v.model_dump() for v in errors],
            "policy_history": policy_history,
            "plan_diff": plan_diff.model_dump(),
            "status": pipeline_status,
            "agent_logs": logs,
        }

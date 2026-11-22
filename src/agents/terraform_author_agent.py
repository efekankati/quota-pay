"""
Agent 1 — Terraform Prompt-to-HCL & Config Generator (`terraform_author_agent`).

Translates natural-language infrastructure requests plus FIGARO CLI placement
directives (and any structured policy feedback from Agent 2) into valid, modular
Terraform HCL (`infra/agent_generated.tf`) and `infra/terraform.tfvars.json`
targeting Proxmox VE (`bpg/proxmox`) as the primary provider ($0.00/hr default),
while keeping existing AWS Spot modules intact behind `enable_aws = false`.
"""

from __future__ import annotations

import copy
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from src.orchestrator.actuator import TerraformActuator
from src.orchestrator.schema import NodeAllocation, PlacementPlan, ServiceType, TargetProvider

from .rubrics import DANGEROUS_EXPOSED_PORTS
from .state import AgentLogEntry, AgentPipelineConfig, AgentState
from .telemetry import noop_emit


def render_proxmox_agent_hcl(
    directive: Dict[str, Any],
    tfvars_data: Dict[str, Any],
    retry_count: int,
    notes: List[str],
) -> str:
    """
    Renders a valid, modular Terraform HCL overlay (`agent_generated.tf`) capturing
    the agent-authored Proxmox-first deployment specification, firewall hardening
    posture, and structured output manifest without duplicating `infra/main.tf` resources.
    """
    scenario = str(directive.get("scenario", "all_edge"))
    directive_id = str(directive.get("directive_id", "dir-unknown"))
    source = str(directive.get("source", "mock-proxmox-first"))
    enable_aws = "true" if bool(tfvars_data.get("enable_aws", False)) else "false"
    disable_pw = "true" if bool(tfvars_data.get("proxmox_disable_password_auth", True)) else "false"
    ssh_cidr = str(tfvars_data.get("proxmox_ssh_allowed_cidr", "192.168.178.0/24"))
    allowed_cidrs = tfvars_data.get("proxmox_allowed_cidrs") or ["192.168.178.0/24"]
    cidrs_hcl = ", ".join(f'"{c}"' for c in allowed_cidrs)

    plan_nodes = tfvars_data.get("placement_plan") or {}
    node_entries: List[str] = []
    for node_id, spec in plan_nodes.items():
        svcs_hcl = ", ".join(f'"{s}"' for s in (spec.get("services") or []))
        ports_hcl = ", ".join(str(int(p)) for p in (spec.get("allowed_ports") or [80, 443]))
        fw_hcl = "true" if bool(spec.get("enable_firewall", True)) else "false"
        node_entries.append(
            f'    "{node_id}" = {{\n'
            f'      provider            = "{spec.get("target_provider", "proxmox")}"\n'
            f'      target_node         = "{spec.get("target_node") or "pve"}"\n'
            f'      cpu_cores           = {int(spec.get("cpu_cores", 2))}\n'
            f'      memory_mb           = {int(spec.get("memory_mb", 1024))}\n'
            f'      disk_gb             = {int(spec.get("disk_gb", 8))}\n'
            f'      virtualization_type = "{spec.get("virtualization_type", "lxc")}"\n'
            f'      enable_firewall     = {fw_hcl}\n'
            f'      allowed_ports       = [{ports_hcl}]\n'
            f'      services            = [{svcs_hcl}]\n'
            f'    }}'
        )
    nodes_block = "\n".join(node_entries)
    notes_comment = "\n".join(f"#   - {n}" for n in notes) if notes else "#   - Initial Proxmox-first synthesis"

    return f"""# =============================================================================
# AUTONOMOUSLY AUTHORED BY AGENT 1 (terraform_author_agent)
# Directive ID : {directive_id}
# Source       : {source}
# Scenario     : {scenario}
# Revision     : {retry_count}
# Generated At : {datetime.now(timezone.utc).isoformat()}
# Author Notes :
{notes_comment}
# =============================================================================

locals {{
  agent_pipeline_spec = {{
    directive_id            = "{directive_id}"
    source                  = "{source}"
    scenario                = "{scenario}"
    revision                = {retry_count}
    proxmox_first           = true
    aws_opt_in_enabled      = {enable_aws}
    ssh_password_auth_off   = {disable_pw}
    ssh_allowed_cidr        = "{ssh_cidr}"
    allowed_ingress_cidrs   = [{cidrs_hcl}]
    authored_nodes = {{
{nodes_block}
    }}
  }}
}}

output "agent_deployment_manifest" {{
  description = "Structured manifest authored by Agent 1 and validated by Agent 2"
  value = {{
    spec              = local.agent_pipeline_spec
    active_proxmox    = keys(module.proxmox_nodes)
    active_aws        = keys(module.aws_spot_nodes)
    aws_gate_open     = var.enable_aws
  }}
}}
"""


class TerraformAuthorAgent:
    """Agent 1: Translates prompt + FIGARO CLI constraints + policy feedback into Terraform HCL & tfvars."""

    NAME = "terraform_author_agent"

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

    def _apply_policy_feedback(
        self,
        directive: Dict[str, Any],
        tfvars_data: Dict[str, Any],
        feedback: List[Dict[str, Any]],
    ) -> List[str]:
        """Self-corrects placement_plan and security settings based on Agent 2's structured diff feedback."""
        applied_fixes: List[str] = []
        plan = copy.deepcopy(tfvars_data.get("placement_plan") or {})
        req_cpu = int(directive.get("requested_cpu_cores", 2))
        req_ram = int(directive.get("requested_memory_mb", 1024))
        req_disk = int(directive.get("requested_disk_gb", 8))
        req_pve = str(directive.get("target_proxmox_node", "pve"))
        req_services = [str(s) for s in directive.get("requested_services", ["quota-ingress", "quota-web-frontend", "quota-ai-proxy"])]
        req_count = int(directive.get("requested_node_count", 1))

        codes = {str(v.get("code", "")) for v in feedback}

        if "AWS_NOT_AUTHORIZED" in codes:
            tfvars_data["enable_aws"] = False
            # Reassign any AWS-placed services onto Proxmox edge node
            all_svcs = sorted(
                set(req_services)
                | {
                    str(s)
                    for n in plan.values()
                    if isinstance(n, dict)
                    for s in (n.get("services") or [])
                }
            )
            plan = {
                k: v for k, v in plan.items()
                if isinstance(v, dict) and str(v.get("target_provider", "")).lower() != "aws"
            }
            if not plan:
                plan["edge-primary"] = {
                    "target_provider": "proxmox",
                    "target_node": req_pve,
                    "cpu_cores": req_cpu,
                    "memory_mb": req_ram,
                    "disk_gb": req_disk,
                    "virtualization_type": "lxc",
                    "enable_firewall": True,
                    "allowed_ports": [80, 443],
                    "services": all_svcs,
                }
            else:
                first_key = next(iter(plan.keys()))
                plan[first_key]["services"] = sorted(set(plan[first_key].get("services", [])) | set(all_svcs))
            directive["scenario"] = "all_edge"
            applied_fixes.append("Stripped unauthorized AWS nodes, set enable_aws=false, consolidated services onto Proxmox VE.")

        if "CAPABILITY_MISMATCH_NODE_COUNT" in codes:
            while len(plan) < req_count:
                idx = len(plan) + 1
                plan[f"edge-node-{idx:02d}"] = {
                    "target_provider": "proxmox",
                    "target_node": req_pve,
                    "cpu_cores": req_cpu,
                    "memory_mb": req_ram,
                    "disk_gb": req_disk,
                    "virtualization_type": "lxc",
                    "enable_firewall": True,
                    "allowed_ports": [80, 443],
                    "services": [req_services[(idx - 1) % len(req_services)]],
                }
            applied_fixes.append(f"Expanded placement_plan to satisfy requested node_count={req_count}.")

        if "CAPABILITY_MISMATCH_SERVICES" in codes and plan:
            first_key = next(iter(plan.keys()))
            plan[first_key]["services"] = sorted(set(plan[first_key].get("services", [])) | set(req_services))
            applied_fixes.append(f"Added missing requested services {req_services} onto '{first_key}'.")

        for node_id, node in plan.items():
            if not isinstance(node, dict):
                continue
            if "CAPABILITY_MISMATCH_CPU" in codes and int(node.get("cpu_cores", 0)) < req_cpu:
                node["cpu_cores"] = req_cpu
                applied_fixes.append(f"Adjusted '{node_id}'.cpu_cores -> {req_cpu}.")
            if "CAPABILITY_MISMATCH_RAM" in codes and int(node.get("memory_mb", 0)) < req_ram:
                node["memory_mb"] = req_ram
                applied_fixes.append(f"Adjusted '{node_id}'.memory_mb -> {req_ram}.")
            if "CAPABILITY_MISMATCH_DISK" in codes and int(node.get("disk_gb", 0)) < req_disk:
                node["disk_gb"] = req_disk
                applied_fixes.append(f"Adjusted '{node_id}'.disk_gb -> {req_disk}.")
            if "CAPABILITY_MISMATCH_PROXMOX_NODE" in codes and str(node.get("target_provider", "")).lower() == "proxmox":
                node["target_node"] = req_pve
                applied_fixes.append(f"Aligned '{node_id}'.target_node -> '{req_pve}'.")
            if "PROXMOX_NESTED_VTX_UNSAFE" in codes and str(node.get("target_provider", "")).lower() == "proxmox":
                node["virtualization_type"] = "lxc"
                applied_fixes.append(
                    f"Switched '{node_id}'.virtualization_type from 'qemu' -> 'lxc' (nested VT-x safe fallback)."
                )
            if "FIREWALL_DISABLED" in codes:
                node["enable_firewall"] = True
                applied_fixes.append(f"Enabled Proxmox default-drop firewall on '{node_id}'.")
            if "EXPOSED_MANAGEMENT_PORT" in codes:
                cleaned_ports = [int(p) for p in (node.get("allowed_ports") or [80, 443]) if int(p) not in DANGEROUS_EXPOSED_PORTS]
                node["allowed_ports"] = cleaned_ports or [80, 443]
                applied_fixes.append(f"Stripped dangerous management ports from '{node_id}'.allowed_ports -> {node['allowed_ports']}.")

        if "OPEN_SSH_CIDR" in codes:
            tfvars_data["proxmox_ssh_allowed_cidr"] = "192.168.178.0/24"
            applied_fixes.append("Restricted proxmox_ssh_allowed_cidr to 192.168.178.0/24.")

        if "SSH_PASSWORD_AUTH_ENABLED" in codes:
            tfvars_data["proxmox_disable_password_auth"] = True
            applied_fixes.append("Enforced proxmox_disable_password_auth=true (SSH key-only).")

        if "HARDCODED_SECRET" in codes:
            for secret_key in ("gemini_api_key", "supabase_anon_key", "proxmox_api_token", "proxmox_password"):
                tfvars_data.pop(secret_key, None)
            applied_fixes.append("Stripped hardcoded secret keys from terraform.tfvars.json (using TF_VAR_* injection).")

        tfvars_data["placement_plan"] = plan
        return applied_fixes

    def run(self, state: AgentState) -> AgentState:
        """Executes Agent 1 authoring (or policy-driven self-correction on retry)."""
        started = time.perf_counter()
        directive = copy.deepcopy(state.get("directive") or {})
        retry_count = int(state.get("retry_count", 0))
        feedback = list(state.get("policy_feedback") or [])
        logs = list(state.get("agent_logs") or [])
        notes: List[str] = []

        if retry_count == 0 or not state.get("tfvars_data"):
            self.emit(
                "RUNNING",
                "authoring Proxmox-first Terraform HCL & tfvars",
                detail=f"scenario={directive.get('scenario', 'all_edge')}",
                retry_count=retry_count,
            )
            # Initial synthesis from FIGARO directive
            raw_plan = directive.get("placement_plan") or {}
            plan_obj = PlacementPlan(**raw_plan)
            enable_aws = bool(directive.get("enable_aws", False)) or bool(self.config.enable_aws)

            tfvars_data = plan_obj.to_terraform_vars(enable_aws=enable_aws)
            tfvars_data["proxmox_allowed_cidrs"] = ["192.168.178.0/24"]
            tfvars_data["proxmox_ssh_allowed_cidr"] = "192.168.178.0/24"
            tfvars_data["proxmox_disable_password_auth"] = bool(directive.get("disable_password_auth", True))

            if self.config.use_existing_edge and isinstance(tfvars_data.get("placement_plan"), dict):
                notes.append("use_existing_edge=True noted for Agent 3 SSH/Container 101 sync while keeping full Proxmox spec auditable.")

            notes.append(
                f"Authored initial Proxmox-first Terraform config for scenario='{directive.get('scenario')}' "
                f"(enable_aws={enable_aws}, nodes={list(tfvars_data['placement_plan'].keys())})."
            )
        else:
            # Self-correction pass from Agent 2 feedback
            self.emit(
                "RETRYING",
                "self-correcting from Agent 2 feedback",
                detail=f"{len(feedback)} policy violation(s)",
                retry_count=retry_count,
            )
            tfvars_data = copy.deepcopy(state["tfvars_data"])
            fixes = self._apply_policy_feedback(directive, tfvars_data, feedback)
            notes.extend(fixes or ["Re-evaluated authored Terraform config after Agent 2 feedback."])

        # Write modular Terraform HCL file (`infra/agent_generated.tf`)
        self.emit(
            "RUNNING",
            "writing agent_generated.tf & terraform.tfvars.json",
            retry_count=retry_count,
        )
        infra_dir = self.config.resolved_infra_dir()
        infra_dir.mkdir(parents=True, exist_ok=True)
        hcl_path = infra_dir / self.config.generated_hcl_filename
        hcl_content = render_proxmox_agent_hcl(
            directive=directive,
            tfvars_data=tfvars_data,
            retry_count=retry_count,
            notes=notes,
        )
        hcl_path.write_text(hcl_content, encoding="utf-8")

        # Write terraform.tfvars.json (no secrets embedded; TF_VAR_* handles secrets)
        tfvars_path = infra_dir / self.config.tfvars_filename
        tfvars_path.write_text(json.dumps(tfvars_data, indent=2), encoding="utf-8")

        # Generate docker/.env.placement aligned with the authored topology
        self.emit("RUNNING", "generating docker/.env.placement", retry_count=retry_count)
        dotenv = self.actuator.load_root_dotenv()
        rebuilt_nodes: Dict[str, NodeAllocation] = {}
        for node_id, nspec in (tfvars_data.get("placement_plan") or {}).items():
            rebuilt_nodes[node_id] = NodeAllocation(
                target_provider=TargetProvider(nspec["target_provider"]),
                target_node=nspec.get("target_node"),
                cpu_cores=int(nspec["cpu_cores"]),
                memory_mb=int(nspec["memory_mb"]),
                disk_gb=int(nspec.get("disk_gb", 8)),
                virtualization_type=str(nspec.get("virtualization_type", "lxc")),
                enable_firewall=bool(nspec.get("enable_firewall", True)),
                allowed_ports=[int(p) for p in (nspec.get("allowed_ports") or [80, 443])],
                services=[ServiceType(s) for s in nspec["services"]],
            )
        active_plan = PlacementPlan(
            scenario=str(directive.get("scenario", "all_edge")),
            nodes=rebuilt_nodes,
        )
        env_path = self.actuator.generate_placement_env(
            plan=active_plan,
            edge_ip=self.config.edge_ip,
            cloud_ip=self.config.cloud_ip,
            gemini_api_key=os.getenv("GEMINI_API_KEY") or dotenv.get("GEMINI_API_KEY", ""),
            supabase_url=os.getenv("SUPABASE_URL") or dotenv.get("SUPABASE_URL", "https://nnamvsnorjbsruwhkker.supabase.co"),
            supabase_anon_key=os.getenv("SUPABASE_ANON_KEY") or dotenv.get("SUPABASE_ANON_KEY", ""),
        )

        reasoning = " | ".join(notes)
        logs.append(
            AgentLogEntry(
                agent=self.NAME,
                phase=f"author_rev_{retry_count}",
                status="remediated" if retry_count > 0 else "passed",
                reasoning=reasoning,
                details={
                    "hcl_path": str(hcl_path),
                    "tfvars_path": str(tfvars_path),
                    "placement_env_path": str(env_path),
                    "enable_aws": bool(tfvars_data.get("enable_aws", False)),
                    "nodes": list((tfvars_data.get("placement_plan") or {}).keys()),
                },
            ).model_dump()
        )

        node_names = list((tfvars_data.get("placement_plan") or {}).keys())
        self.emit(
            "PASSED",
            "authored Terraform config",
            detail=f"nodes={node_names}, enable_aws={bool(tfvars_data.get('enable_aws', False))}",
            duration_ms=round((time.perf_counter() - started) * 1000.0, 2),
            retry_count=retry_count,
            metadata={
                "nodes": node_names,
                "enable_aws": bool(tfvars_data.get("enable_aws", False)),
            },
        )

        return {
            **state,
            "directive": directive,
            "authored_hcl_path": str(hcl_path),
            "authored_hcl_content": hcl_content,
            "tfvars_path": str(tfvars_path),
            "tfvars_data": tfvars_data,
            "placement_env_path": str(env_path),
            "author_notes": notes,
            "agent_logs": logs,
        }

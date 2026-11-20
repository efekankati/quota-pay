"""
Validation, Security, Proxmox Constraint & Performance Rubrics (src/agents/rubrics.py).
Used by Agent 2 (Pre-Deployment Policy Guard) and Agent 4 (Post-Deployment Auditor).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set

from .state import AgentPipelineConfig, AuditFinding, PolicyViolation

# Patterns catching accidentally embedded credentials in HCL / tfvars / cloud-init
SECRET_REGEXES: List[tuple[str, re.Pattern[str]]] = [
    ("google_gemini_api_key", re.compile(r"AIza[0-9A-Za-z\-_]{20,}")),
    ("gemini_oauth_token", re.compile(r"AQ\.[0-9A-Za-z\-_]{20,}")),
    ("aws_access_key_id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_pat", re.compile(r"(?:ghp|gho|ghu|ghs)_[0-9A-Za-z]{20,}")),
    ("supabase_secret_key", re.compile(r"sb_secret_[0-9A-Za-z\-_]{10,}")),
    ("private_key_pem", re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----")),
    (
        "proxmox_live_token_in_hcl",
        re.compile(r"[a-zA-Z0-9._-]+@[a-zA-Z]+![a-zA-Z0-9_-]+=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),
    ),
]

PLACEHOLDER_TOKEN = "00000000-0000-0000-0000-000000000000"

# Ports that must never be exposed in public/container service allowlists
DANGEROUS_EXPOSED_PORTS: Set[int] = {2375, 2376, 8006, 3389, 5432, 6379, 27017}

REQUIRED_SECURITY_HEADERS: tuple[str, ...] = (
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
)


def scan_text_for_secrets(text: str, source_label: str) -> List[PolicyViolation]:
    """Scans HCL, tfvars, or provisioning text for hardcoded credentials/secrets."""
    violations: List[PolicyViolation] = []
    if not text:
        return violations

    for secret_name, pattern in SECRET_REGEXES:
        for match in pattern.finditer(text):
            matched = match.group(0)
            if PLACEHOLDER_TOKEN in matched:
                continue
            violations.append(
                PolicyViolation(
                    code="HARDCODED_SECRET",
                    severity="error",
                    category="security",
                    field=source_label,
                    expected="Secret injected via TF_VAR_* / .env at runtime",
                    actual=f"Detected pattern '{secret_name}' in {source_label}",
                    message=f"Hardcoded secret ({secret_name}) detected in {source_label}.",
                    remediation_hint=(
                        "Remove literal credentials from Terraform HCL/tfvars files and rely on "
                        "runtime TF_VAR_* environment injection."
                    ),
                )
            )
    return violations


def evaluate_pre_deploy_rubric(
    directive: Dict[str, Any],
    tfvars_data: Dict[str, Any],
    hcl_files: Dict[str, str],
    plan_json: Optional[Dict[str, Any]],
    config: AgentPipelineConfig,
) -> List[PolicyViolation]:
    """
    Agent 2 Pre-Execution Audit Rubric.
    Checks:
      1. Intent & Capability Alignment (CPU, RAM, disk, node count, services, Proxmox node)
      2. AWS Opt-In Guard (`enable_aws = false` unless explicitly authorized)
      3. Proxmox Nested Virtualization Safety (LXC default or QEMU `kvm=false` guard)
      4. Hardcoded Secret Prevention across HCL and tfvars
      5. Firewall, SSH & Port Exposure Hygiene
    """
    violations: List[PolicyViolation] = []

    placement_plan = tfvars_data.get("placement_plan") or {}
    enable_aws_allowed = bool(directive.get("enable_aws", False)) or bool(config.enable_aws)
    tfvars_enable_aws = bool(tfvars_data.get("enable_aws", False))

    # --- 1. AWS Accidental Provisioning Guard ---
    aws_nodes_in_tfvars = [
        k for k, v in placement_plan.items()
        if isinstance(v, dict) and str(v.get("target_provider", "")).lower() == "aws"
    ]
    if not enable_aws_allowed:
        if tfvars_enable_aws:
            violations.append(
                PolicyViolation(
                    code="AWS_NOT_AUTHORIZED",
                    severity="error",
                    category="aws_opt_in_guard",
                    field="enable_aws",
                    expected=False,
                    actual=True,
                    message="enable_aws=true detected without explicit AWS opt-in.",
                    remediation_hint="Set enable_aws=false and route all workloads to Proxmox VE ($0.00/hr).",
                )
            )
        if aws_nodes_in_tfvars:
            violations.append(
                PolicyViolation(
                    code="AWS_NOT_AUTHORIZED",
                    severity="error",
                    category="aws_opt_in_guard",
                    field="placement_plan",
                    expected="Proxmox-only nodes (target_provider='proxmox')",
                    actual=f"AWS nodes planned: {aws_nodes_in_tfvars}",
                    message=(
                        f"Accidental AWS provisioning blocked for node(s) {aws_nodes_in_tfvars}: "
                        "Proxmox-first policy forbids AWS unless explicitly enabled."
                    ),
                    remediation_hint="Reassign all services to Proxmox VE nodes and set enable_aws=false.",
                )
            )

    # Check real Terraform plan JSON if available for any unexpected aws_* resource creation
    if plan_json and not enable_aws_allowed:
        for rc in plan_json.get("resource_changes", []):
            rtype = str(rc.get("type", ""))
            actions = (rc.get("change") or {}).get("actions", [])
            if rtype.startswith("aws_") and ("create" in actions or "update" in actions):
                violations.append(
                    PolicyViolation(
                        code="AWS_NOT_AUTHORIZED",
                        severity="error",
                        category="aws_opt_in_guard",
                        field=rc.get("address", rtype),
                        expected="0 AWS resources created",
                        actual=f"{rc.get('address')} actions={actions}",
                        message=f"Terraform plan attempts to mutate AWS resource '{rc.get('address')}' while enable_aws=false.",
                        remediation_hint="Set enable_aws=false and eliminate AWS placement nodes.",
                    )
                )

    # --- 2. Intent & Capability Alignment ---
    if not placement_plan:
        violations.append(
            PolicyViolation(
                code="CAPABILITY_MISMATCH_NODE_COUNT",
                severity="error",
                category="intent_alignment",
                field="placement_plan",
                expected=f">= {directive.get('requested_node_count', 1)} node(s)",
                actual="0 nodes",
                message="Generated placement_plan is empty.",
                remediation_hint="Allocate at least one Proxmox VE edge node hosting the requested services.",
            )
        )
    else:
        req_count = int(directive.get("requested_node_count", 1))
        if len(placement_plan) < req_count:
            violations.append(
                PolicyViolation(
                    code="CAPABILITY_MISMATCH_NODE_COUNT",
                    severity="error",
                    category="intent_alignment",
                    field="placement_plan.length",
                    expected=req_count,
                    actual=len(placement_plan),
                    message=f"Requested {req_count} node(s), but placement_plan only defines {len(placement_plan)}.",
                    remediation_hint=f"Author exactly {req_count} node allocation(s) in placement_plan.",
                )
            )

        req_services = {str(s) for s in directive.get("requested_services", [])}
        placed_services = {
            str(s)
            for node in placement_plan.values()
            if isinstance(node, dict)
            for s in (node.get("services") or [])
        }
        missing_services = sorted(req_services - placed_services)
        if missing_services:
            violations.append(
                PolicyViolation(
                    code="CAPABILITY_MISMATCH_SERVICES",
                    severity="error",
                    category="intent_alignment",
                    field="placement_plan.*.services",
                    expected=sorted(req_services),
                    actual=sorted(placed_services),
                    message=f"Missing requested service(s) in placement_plan: {missing_services}.",
                    remediation_hint=f"Ensure all requested services {sorted(req_services)} are placed on target nodes.",
                )
            )

        req_cpu = int(directive.get("requested_cpu_cores", 2))
        req_ram = int(directive.get("requested_memory_mb", 1024))
        req_disk = int(directive.get("requested_disk_gb", 8))
        req_pve_node = str(directive.get("target_proxmox_node", "pve"))

        for node_id, node in placement_plan.items():
            if not isinstance(node, dict):
                continue
            provider = str(node.get("target_provider", "")).lower()
            actual_cpu = int(node.get("cpu_cores", 0))
            actual_ram = int(node.get("memory_mb", 0))
            actual_disk = int(node.get("disk_gb", 8))

            if actual_cpu < req_cpu:
                violations.append(
                    PolicyViolation(
                        code="CAPABILITY_MISMATCH_CPU",
                        severity="error",
                        category="intent_alignment",
                        field=f"placement_plan.{node_id}.cpu_cores",
                        expected=f">= {req_cpu}",
                        actual=actual_cpu,
                        message=f"Node '{node_id}' allocates {actual_cpu} vCPU, below requested {req_cpu}.",
                        remediation_hint=f"Increase cpu_cores on '{node_id}' to at least {req_cpu}.",
                    )
                )
            if actual_ram < req_ram:
                violations.append(
                    PolicyViolation(
                        code="CAPABILITY_MISMATCH_RAM",
                        severity="error",
                        category="intent_alignment",
                        field=f"placement_plan.{node_id}.memory_mb",
                        expected=f">= {req_ram}",
                        actual=actual_ram,
                        message=f"Node '{node_id}' allocates {actual_ram}MB RAM, below requested {req_ram}MB.",
                        remediation_hint=f"Increase memory_mb on '{node_id}' to at least {req_ram}.",
                    )
                )
            if actual_disk < req_disk:
                violations.append(
                    PolicyViolation(
                        code="CAPABILITY_MISMATCH_DISK",
                        severity="error",
                        category="intent_alignment",
                        field=f"placement_plan.{node_id}.disk_gb",
                        expected=f">= {req_disk}",
                        actual=actual_disk,
                        message=f"Node '{node_id}' allocates {actual_disk}GB disk, below requested {req_disk}GB.",
                        remediation_hint=f"Increase disk_gb on '{node_id}' to at least {req_disk}.",
                    )
                )

            if provider == "proxmox":
                actual_pve = str(node.get("target_node") or "")
                if actual_pve != req_pve_node:
                    violations.append(
                        PolicyViolation(
                            code="CAPABILITY_MISMATCH_PROXMOX_NODE",
                            severity="error",
                            category="proxmox_constraints",
                            field=f"placement_plan.{node_id}.target_node",
                            expected=req_pve_node,
                            actual=actual_pve,
                            message=f"Node '{node_id}' targets Proxmox host '{actual_pve}', expected '{req_pve_node}'.",
                            remediation_hint=f"Set target_node to '{req_pve_node}'.",
                        )
                    )

                # --- 3. Proxmox Nested Virtualization Guard ---
                virt = str(node.get("virtualization_type", "lxc")).lower()
                if virt == "qemu" and not config.nested_vtx_available:
                    violations.append(
                        PolicyViolation(
                            code="PROXMOX_NESTED_VTX_UNSAFE",
                            severity="error",
                            category="proxmox_constraints",
                            field=f"placement_plan.{node_id}.virtualization_type",
                            expected="lxc (or QEMU with nested VT-x verified / kvm=false)",
                            actual="qemu (nested VT-x unavailable on VMware-hosted Proxmox)",
                            message=(
                                f"Node '{node_id}' requests QEMU VM while nested hardware virtualization "
                                "(VT-x/AMD-V) is unavailable on this Proxmox host."
                            ),
                            remediation_hint=(
                                "Switch virtualization_type to 'lxc' (nested-VT-x safe container with Docker nesting) "
                                "or explicitly verify nested VT-x before enabling QEMU."
                            ),
                        )
                    )

                # --- 4. Firewall & Port Exposure Rules ---
                if directive.get("require_firewall", True) and not bool(node.get("enable_firewall", True)):
                    violations.append(
                        PolicyViolation(
                            code="FIREWALL_DISABLED",
                            severity="error",
                            category="security",
                            field=f"placement_plan.{node_id}.enable_firewall",
                            expected=True,
                            actual=False,
                            message=f"Proxmox firewall is disabled on node '{node_id}'.",
                            remediation_hint="Set enable_firewall=true to enforce default-drop ingress.",
                        )
                    )

                ports = [int(p) for p in (node.get("allowed_ports") or [])]
                exposed_bad = sorted(set(ports) & DANGEROUS_EXPOSED_PORTS)
                if exposed_bad:
                    violations.append(
                        PolicyViolation(
                            code="EXPOSED_MANAGEMENT_PORT",
                            severity="error",
                            category="security",
                            field=f"placement_plan.{node_id}.allowed_ports",
                            expected="Only application service ports (80, 443, optional 3000)",
                            actual=ports,
                            message=f"Sensitive management/daemon port(s) {exposed_bad} exposed on '{node_id}'.",
                            remediation_hint=f"Remove port(s) {exposed_bad} from allowed_ports.",
                        )
                    )

    # Check SSH CIDR & password auth hardening in tfvars
    ssh_cidr = str(tfvars_data.get("proxmox_ssh_allowed_cidr", "192.168.178.0/24")).strip()
    if ssh_cidr in ("0.0.0.0/0", "::/0", "*"):
        violations.append(
            PolicyViolation(
                code="OPEN_SSH_CIDR",
                severity="error",
                category="security",
                field="proxmox_ssh_allowed_cidr",
                expected="Restricted LAN/management CIDR (e.g. 192.168.178.0/24)",
                actual=ssh_cidr,
                message="SSH port 22 is open to 0.0.0.0/0 in Terraform variables.",
                remediation_hint="Restrict proxmox_ssh_allowed_cidr to LAN subnet 192.168.178.0/24.",
            )
        )

    if directive.get("disable_password_auth", True) and tfvars_data.get("proxmox_disable_password_auth") is False:
        violations.append(
            PolicyViolation(
                code="SSH_PASSWORD_AUTH_ENABLED",
                severity="error",
                category="security",
                field="proxmox_disable_password_auth",
                expected=True,
                actual=False,
                message="SSH password authentication is enabled on Proxmox edge nodes.",
                remediation_hint="Set proxmox_disable_password_auth=true for SSH key-only authentication.",
            )
        )

    # --- 5. Static HCL Inspection (Nested VT-x cpu=host, Hardcoded Secrets) ---
    for filename, content in hcl_files.items():
        violations.extend(scan_text_for_secrets(content, filename))
        if not config.nested_vtx_available and re.search(r'type\s*=\s*"host"', content):
            violations.append(
                PolicyViolation(
                    code="PROXMOX_NESTED_VTX_UNSAFE",
                    severity="error",
                    category="proxmox_constraints",
                    field=filename,
                    expected='LXC container or QEMU cpu.type = "qemu64" with kvm=0',
                    actual='cpu.type = "host"',
                    message=f"HCL file '{filename}' sets CPU passthrough (type=\"host\") without nested VT-x.",
                    remediation_hint='Switch to LXC container mode or use cpu.type = "qemu64" with kvm=false.',
                )
            )

    violations.extend(
        scan_text_for_secrets(json.dumps(tfvars_data, indent=2), config.tfvars_filename)
    )

    return violations


def evaluate_post_deploy_rubric(
    directive: Dict[str, Any],
    tfvars_data: Dict[str, Any],
    runtime_telemetry: Dict[str, Any],
    caddyfile_text: str,
    cloud_init_text: str,
    config: AgentPipelineConfig,
) -> List[AuditFinding]:
    """
    Agent 4 Post-Deployment Audit Rubric spanning:
      1. Capability Verification (live CPU, RAM, open ports, running containers)
      2. Security Hardening (exposed management ports, firewall, SSH password auth,
         0.0.0.0/0 ingress, HTTP security headers, secret scan)
      3. Performance Tuning (HTTP latency, memory/CPU pressure, Caddy compression & caching)
    """
    findings: List[AuditFinding] = []
    placement_plan = tfvars_data.get("placement_plan") or {}
    req_cpu = int(directive.get("requested_cpu_cores", 2))
    req_ram = int(directive.get("requested_memory_mb", 1024))
    req_services = sorted(str(s) for s in directive.get("requested_services", []))

    # --- Pillar 1: Capability Verification ---
    obs_cpu = int(runtime_telemetry.get("allocated_cpu_cores", req_cpu))
    obs_ram = int(runtime_telemetry.get("allocated_memory_mb", req_ram))
    obs_containers = sorted(str(c) for c in runtime_telemetry.get("running_containers", req_services))
    obs_ports = sorted(int(p) for p in runtime_telemetry.get("open_ports", [80, 443]))

    if obs_cpu < req_cpu:
        findings.append(
            AuditFinding(
                finding_id="CAP-CPU-UNDERSIZED",
                pillar="capability",
                severity="high",
                resource="proxmox_edge_node.cpu",
                issue=f"Live allocated vCPU ({obs_cpu}) is below requested specification ({req_cpu}).",
                expected=req_cpu,
                observed=obs_cpu,
                auto_remediable=True,
            )
        )
    if obs_ram < req_ram:
        findings.append(
            AuditFinding(
                finding_id="CAP-RAM-UNDERSIZED",
                pillar="capability",
                severity="high",
                resource="proxmox_edge_node.memory",
                issue=f"Live allocated RAM ({obs_ram}MB) is below requested specification ({req_ram}MB).",
                expected=req_ram,
                observed=obs_ram,
                auto_remediable=True,
            )
        )

    # Normalize edge container names (quota-edge-ingress -> quota-ingress) when comparing
    normalized_running: Set[str] = set()
    for c in obs_containers:
        normalized_running.add(c)
        if "ingress" in c:
            normalized_running.add("quota-ingress")
        if "frontend" in c:
            normalized_running.add("quota-web-frontend")
        if "ai-proxy" in c:
            normalized_running.add("quota-ai-proxy")
    missing_live = [s for s in req_services if s not in normalized_running]
    if missing_live:
        findings.append(
            AuditFinding(
                finding_id="CAP-SERVICES-MISSING",
                pillar="capability",
                severity="critical",
                resource="docker_compose_stack",
                issue=f"Required container service(s) not running: {missing_live}.",
                expected=req_services,
                observed=obs_containers,
                auto_remediable=False,
            )
        )

    # --- Pillar 2: Security Hardening ---
    exposed_mgmt = sorted(set(obs_ports) & DANGEROUS_EXPOSED_PORTS)
    if exposed_mgmt:
        findings.append(
            AuditFinding(
                finding_id="SEC-EXPOSED-MGMT-PORT",
                pillar="security",
                severity="critical",
                resource="proxmox_firewall.allowed_ports",
                issue=f"Exposed management/daemon port(s) detected on live node: {exposed_mgmt}.",
                expected="Management ports closed to external ingress",
                observed=obs_ports,
                auto_remediable=True,
            )
        )

    fw_enabled = runtime_telemetry.get("firewall_enabled")
    if fw_enabled is None:
        fw_enabled = all(
            bool(n.get("enable_firewall", True))
            for n in placement_plan.values()
            if isinstance(n, dict) and str(n.get("target_provider", "")).lower() == "proxmox"
        )
    if not fw_enabled:
        findings.append(
            AuditFinding(
                finding_id="SEC-FIREWALL-DISABLED",
                pillar="security",
                severity="high",
                resource="proxmox_virtual_environment_firewall_options",
                issue="Proxmox per-node firewall is disabled (missing default-drop ingress policy).",
                expected=True,
                observed=False,
                auto_remediable=True,
            )
        )

    ssh_pw_enabled = runtime_telemetry.get("ssh_password_auth_enabled")
    if ssh_pw_enabled is None:
        ssh_pw_enabled = (
            tfvars_data.get("proxmox_disable_password_auth") is False
            or ("PasswordAuthentication yes" in cloud_init_text and "disable_password_auth" not in cloud_init_text)
        )
    if ssh_pw_enabled:
        findings.append(
            AuditFinding(
                finding_id="SEC-SSH-PASSWORD-AUTH",
                pillar="security",
                severity="high",
                resource="sshd_config / proxmox_disable_password_auth",
                issue="Root/SSH password authentication is enabled instead of key-only authentication.",
                expected="PasswordAuthentication no",
                observed="PasswordAuthentication yes",
                auto_remediable=True,
            )
        )

    ssh_cidr = str(
        runtime_telemetry.get("ssh_allowed_cidr")
        or tfvars_data.get("proxmox_ssh_allowed_cidr", "192.168.178.0/24")
    ).strip()
    if ssh_cidr in ("0.0.0.0/0", "::/0"):
        findings.append(
            AuditFinding(
                finding_id="SEC-PERMISSIVE-SSH-CIDR",
                pillar="security",
                severity="high",
                resource="proxmox_firewall_rules.ssh",
                issue="SSH ingress CIDR allows 0.0.0.0/0 instead of a restricted LAN CIDR.",
                expected="192.168.178.0/24",
                observed=ssh_cidr,
                auto_remediable=True,
            )
        )

    allowed_cidrs = runtime_telemetry.get("allowed_cidrs") or tfvars_data.get("proxmox_allowed_cidrs") or []
    if any(c in ("0.0.0.0/0", "::/0") for c in allowed_cidrs) and not directive.get("enable_aws", False):
        findings.append(
            AuditFinding(
                finding_id="SEC-PERMISSIVE-INGRESS-CIDR",
                pillar="security",
                severity="medium",
                resource="proxmox_firewall_rules.ingress",
                issue="Proxmox local-edge firewall allows 0.0.0.0/0 ingress instead of LAN CIDR scope.",
                expected=["192.168.178.0/24"],
                observed=allowed_cidrs,
                auto_remediable=True,
            )
        )

    missing_headers = [h for h in REQUIRED_SECURITY_HEADERS if h not in caddyfile_text]
    if missing_headers:
        findings.append(
            AuditFinding(
                finding_id="SEC-MISSING-HTTP-HEADERS",
                pillar="security",
                severity="medium",
                resource="docker/Caddyfile.ingress",
                issue=f"Ingress Caddyfile missing recommended HTTP security headers: {missing_headers}.",
                expected=list(REQUIRED_SECURITY_HEADERS),
                observed=[h for h in REQUIRED_SECURITY_HEADERS if h in caddyfile_text],
                auto_remediable=True,
            )
        )

    secret_hits = scan_text_for_secrets(json.dumps(tfvars_data), config.tfvars_filename)
    if secret_hits:
        findings.append(
            AuditFinding(
                finding_id="SEC-UNENCRYPTED-SECRET",
                pillar="security",
                severity="critical",
                resource=config.tfvars_filename,
                issue=f"Detected {len(secret_hits)} unencrypted secret(s) in generated Terraform variables.",
                expected="Zero literal secrets in tfvars",
                observed=[v.actual for v in secret_hits],
                auto_remediable=True,
            )
        )

    # --- Pillar 3: Performance Tuning ---
    obs_latency_ms = float(runtime_telemetry.get("http_latency_ms", 18.0))
    if obs_latency_ms > config.latency_threshold_ms:
        findings.append(
            AuditFinding(
                finding_id="PERF-HIGH-LATENCY",
                pillar="performance",
                severity="medium",
                resource="quota-ingress / node_compute",
                issue=(
                    f"Measured HTTP round-trip latency ({obs_latency_ms:.1f}ms) exceeds "
                    f"threshold ({config.latency_threshold_ms:.1f}ms)."
                ),
                expected=f"<= {config.latency_threshold_ms:.1f}ms",
                observed=f"{obs_latency_ms:.1f}ms",
                auto_remediable=True,
            )
        )

    obs_mem_pct = float(runtime_telemetry.get("memory_utilization_pct", 32.0))
    if obs_mem_pct > config.max_memory_utilization_pct:
        findings.append(
            AuditFinding(
                finding_id="PERF-MEMORY-PRESSURE",
                pillar="performance",
                severity="high",
                resource="proxmox_edge_node.memory",
                issue=(
                    f"Container memory utilization ({obs_mem_pct:.1f}%) exceeds threshold "
                    f"({config.max_memory_utilization_pct:.1f}%)."
                ),
                expected=f"<= {config.max_memory_utilization_pct:.1f}%",
                observed=f"{obs_mem_pct:.1f}%",
                auto_remediable=True,
            )
        )

    obs_cpu_pct = float(runtime_telemetry.get("cpu_utilization_pct", 24.0))
    if obs_cpu_pct > config.max_cpu_utilization_pct:
        findings.append(
            AuditFinding(
                finding_id="PERF-CPU-PRESSURE",
                pillar="performance",
                severity="high",
                resource="proxmox_edge_node.cpu",
                issue=(
                    f"Container CPU utilization ({obs_cpu_pct:.1f}%) exceeds threshold "
                    f"({config.max_cpu_utilization_pct:.1f}%)."
                ),
                expected=f"<= {config.max_cpu_utilization_pct:.1f}%",
                observed=f"{obs_cpu_pct:.1f}%",
                auto_remediable=True,
            )
        )

    has_compression = "encode" in caddyfile_text and ("gzip" in caddyfile_text or "zstd" in caddyfile_text)
    if not has_compression:
        findings.append(
            AuditFinding(
                finding_id="PERF-MISSING-COMPRESSION",
                pillar="performance",
                severity="medium",
                resource="docker/Caddyfile.ingress",
                issue="Caddy ingress is missing response compression (`encode zstd gzip`).",
                expected="encode zstd gzip",
                observed="compression directive absent",
                auto_remediable=True,
            )
        )

    has_static_cache = "Cache-Control" in caddyfile_text
    if not has_static_cache:
        findings.append(
            AuditFinding(
                finding_id="PERF-MISSING-STATIC-CACHE",
                pillar="performance",
                severity="low",
                resource="docker/Caddyfile.ingress",
                issue="Caddy ingress is missing static asset `Cache-Control` headers.",
                expected="Cache-Control static asset directive",
                observed="Cache-Control absent",
                auto_remediable=True,
            )
        )

    return findings

#!/usr/bin/env python3
"""
Quota Pay — Proxmox-First 4-Agent Autonomous Terraform Deployment CLI.

Usage:
  python scripts/run_agent_pipeline.py --prompt "Deploy Quota Pay on Proxmox with 4 cores and 2048MB RAM"
  python scripts/run_agent_pipeline.py --prompt "Deploy Quota Pay" --figaro-cmd "figaro-cli solve --json"
  cat figaro_output.json | python scripts/run_agent_pipeline.py --prompt "Apply FIGARO plan" --figaro-stdin
  python scripts/run_agent_pipeline.py --prompt "Deploy hybrid with AWS Spot AI proxy" --enable-aws
  python scripts/run_agent_pipeline.py --prompt "Deploy all-edge on Proxmox" --use-existing-edge --live
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.agents import AgentPipelineConfig, MultiAgentSupervisor
from src.orchestrator.actuator import TerraformActuator
from src.orchestrator.figaro_cli_bridge import read_piped_stdin_if_present


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run Quota Pay's Proxmox-First 4-Agent Autonomous Terraform Pipeline"
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default="Deploy Quota Pay full stack on Proxmox VE node pve with 2 cores and 1024MB RAM",
        help="Natural-language infrastructure deployment request",
    )
    parser.add_argument(
        "--figaro-cmd",
        type=str,
        default=None,
        help="External FIGARO CLI command to invoke (receives JSON on stdin or {input_json} file)",
    )
    parser.add_argument(
        "--figaro-file",
        type=str,
        default=None,
        help="Path to a FIGARO CLI JSON output file",
    )
    parser.add_argument(
        "--figaro-stdin",
        action="store_true",
        help="Read piped FIGARO CLI JSON placement directives from stdin",
    )
    parser.add_argument(
        "--strict-figaro-cli",
        action="store_true",
        help="Abort instead of falling back to local Proxmox-first mock if --figaro-cmd fails",
    )
    parser.add_argument(
        "--enable-aws",
        action="store_true",
        help="Explicitly opt in to AWS Spot provisioning (Proxmox-first default: disabled / $0.00/hr)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Execute live terraform apply and real SSH/HTTP verification (default is safe dry-run)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicitly run in non-mutating dry-run mode (default unless --live is set)",
    )
    parser.add_argument(
        "--use-existing-edge",
        action="store_true",
        help="Reuse existing Proxmox LXC Container 101 via SSH rather than provisioning a new container",
    )
    parser.add_argument(
        "--nested-vtx-available",
        action="store_true",
        help="Declare that hardware nested VT-x/AMD-V is enabled on the Proxmox host (allows QEMU without fallback)",
    )
    parser.add_argument(
        "--proxmox-host",
        type=str,
        default=None,
        help="Proxmox VE API/SSH host IP (defaults to PROXMOX_HOST env var or 192.168.178.125)",
    )
    parser.add_argument(
        "--edge-ip",
        type=str,
        default=None,
        help="Proxmox edge container IP (defaults to EDGE_IP env var or 192.168.178.128)",
    )
    parser.add_argument(
        "--edge-container-id",
        type=int,
        default=101,
        help="Existing Proxmox LXC container ID when using --use-existing-edge (default: 101)",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Maximum Agent 2 -> Agent 1 policy self-correction retries (default: 3)",
    )
    parser.add_argument(
        "--report-dir",
        type=str,
        default=None,
        help="Output directory for deployment_audit_<timestamp>.{json,md} reports (default: reports/)",
    )
    parser.add_argument(
        "--no-auto-remediate",
        action="store_true",
        help="Disable Agent 4 autonomous patching (audit-only reporting)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit final structured summary JSON to stdout",
    )

    args = parser.parse_args(argv)

    # Load root .env once so PROXMOX_HOST / FIGARO_CLI_CMD / TF_VAR_* are available
    actuator = TerraformActuator(project_root=PROJECT_ROOT)
    dotenv = actuator.load_root_dotenv()

    execution_mode = "live" if (args.live and not args.dry_run) else "dry-run"
    pve_host = args.proxmox_host or os.getenv("PROXMOX_HOST") or dotenv.get("PROXMOX_HOST") or "192.168.178.125"
    edge_ip = args.edge_ip or os.getenv("EDGE_IP") or dotenv.get("EDGE_IP") or "192.168.178.128"

    stdin_payload = read_piped_stdin_if_present() if args.figaro_stdin else None

    config = AgentPipelineConfig(
        project_root=PROJECT_ROOT,
        report_dir=Path(args.report_dir).resolve() if args.report_dir else (PROJECT_ROOT / "reports"),
        execution_mode=execution_mode,
        enable_aws=bool(args.enable_aws),
        use_existing_edge=bool(args.use_existing_edge),
        max_retries=args.max_retries,
        nested_vtx_available=bool(args.nested_vtx_available),
        proxmox_host=pve_host,
        edge_ip=edge_ip,
        edge_container_id=args.edge_container_id,
        strict_figaro_cli=bool(args.strict_figaro_cli),
        auto_remediate=not bool(args.no_auto_remediate),
    )

    supervisor = MultiAgentSupervisor(config=config)
    final_state = supervisor.run(
        prompt=args.prompt,
        figaro_cmd=args.figaro_cmd,
        figaro_stdin=stdin_payload,
        figaro_file=args.figaro_file,
    )

    if args.json:
        summary = {
            "run_id": final_state.get("run_id"),
            "status": final_state.get("status"),
            "engine": supervisor.engine_name,
            "execution_mode": execution_mode,
            "enable_aws": bool((final_state.get("tfvars_data") or {}).get("enable_aws", False)),
            "guard_approved": final_state.get("guard_approved", False),
            "retry_count": final_state.get("retry_count", 0),
            "deploy_succeeded": final_state.get("deploy_succeeded", False),
            "audit_passed": final_state.get("audit_passed", False),
            "remediations_applied": len(final_state.get("remediations_applied", [])),
            "report_json_path": final_state.get("report_json_path"),
            "report_md_path": final_state.get("report_md_path"),
        }
        print(json.dumps(summary, indent=2))
    else:
        print("=" * 76)
        print("🤖 QUOTA PAY — PROXMOX-FIRST 4-AGENT AUTONOMOUS TERRAFORM PIPELINE")
        print(f"   Run ID          : {final_state.get('run_id')}")
        print(f"   Engine          : {supervisor.engine_name}")
        print(f"   Execution Mode  : {execution_mode.upper()}")
        print(f"   AWS Opt-In      : {bool((final_state.get('tfvars_data') or {}).get('enable_aws', False))}")
        print(f"   Final Status    : {final_state.get('status')}")
        print("=" * 76)
        for entry in final_state.get("agent_logs", []):
            print(
                f"  [{entry.get('agent')}] ({entry.get('phase')} -> {entry.get('status')}): "
                f"{entry.get('reasoning')}"
            )
        print("-" * 76)
        print(f"  Authored HCL    : {final_state.get('authored_hcl_path')}")
        print(f"  Terraform Vars  : {final_state.get('tfvars_path')}")
        print(f"  JSON Audit      : {final_state.get('report_json_path')}")
        print(f"  Markdown Audit  : {final_state.get('report_md_path')}")
        print("=" * 76)

    ok = final_state.get("status") in ("completed", "deployed")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

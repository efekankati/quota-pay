#!/usr/bin/env python3
"""
Quota Pay — Multi-Node Orchestration Deployment Script
Configures and provisions Edge (Proxmox VE) and Cloud (AWS Spot) nodes.

Usage:
  python scripts/deploy_nodes.py --scenario=hybrid --prepare-only
  python scripts/deploy_nodes.py --scenario=all_edge --prepare-only
  python scripts/deploy_nodes.py --scenario=cloud_burst --prepare-only
  python scripts/deploy_nodes.py --scenario=hybrid --apply
"""

import sys
import argparse
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.orchestrator.figaro_adapter import FigaroPlacementAdapter
from src.orchestrator.actuator import TerraformActuator


def main():
    parser = argparse.ArgumentParser(
        description="Deploy Quota Pay across Proxmox VE Edge and AWS Cloud Spot"
    )
    parser.add_argument(
        "--scenario",
        choices=["hybrid", "all_edge", "cloud_burst"],
        default="hybrid",
        help="Target placement scenario (default: hybrid)",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Prepare configuration files, tfvars, and environments WITHOUT applying infrastructure",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute terraform apply to provision and start infrastructure",
    )
    parser.add_argument(
        "--destroy",
        action="store_true",
        help="Tear down and destroy all deployed infrastructure across Cloud, Edge, and Local",
    )
    parser.add_argument(
        "--purge-edge-container",
        action="store_true",
        help="When destroying, completely purge LXC Container 101 from Proxmox",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate execution without applying real infrastructure mutations",
    )
    parser.add_argument(
        "--edge-ip",
        default="192.168.178.128",
        help="Proxmox edge container IP address (default: 192.168.178.128)",
    )
    parser.add_argument(
        "--cloud-ip",
        default="15.160.125.0",
        help="AWS Spot node IP address (default: 15.160.125.0)",
    )

    args = parser.parse_args()

    if args.destroy:
        from scripts.destroy_all import main as destroy_main
        sub_args = []
        if args.purge_edge_container:
            sub_args.append("--purge-edge-container")
        if args.dry_run:
            sub_args.append("--dry-run")
        destroy_main(sub_args)
        return

    print("=" * 70)
    print("🚀 QUOTA PAY MULTI-NODE ORCHESTRATION PIPELINE")
    print(f"   Target Scenario : {args.scenario}")
    print(f"   Edge IP Node    : {args.edge_ip}")
    print(f"   Cloud IP Node   : {args.cloud_ip}")
    print(f"   Execution Mode  : {'PREPARE ONLY (No Apply)' if args.prepare_only or not args.apply else 'LIVE APPLY'}")
    print("=" * 70)

    # 1. Generate Placement Plan
    adapter = FigaroPlacementAdapter()
    plan = adapter.generate_mock_plan(scenario=args.scenario)
    print(f"\n📦 Generated Plan for scenario '{plan.scenario}':")
    for name, node in plan.nodes.items():
        print(f"   - Node '{name}' ({node.target_provider}): {node.cpu_cores} cores, {node.memory_mb}MB RAM -> {node.services}")

    # 2. Actuator Configuration
    actuator = TerraformActuator(project_root=PROJECT_ROOT)

    # 3. Serialize Terraform vars
    tfvars_path = actuator.export_tfvars_json(plan)
    print(f"\n✅ Serialized Terraform variables to: {tfvars_path}")

    # 4. Generate dynamic Docker environment
    import os
    env_path = actuator.generate_placement_env(
        plan=plan,
        edge_ip=args.edge_ip,
        cloud_ip=args.cloud_ip,
        gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
        supabase_url=os.getenv("SUPABASE_URL", "https://nnamvsnorjbsruwhkker.supabase.co"),
        supabase_anon_key=os.getenv("SUPABASE_ANON_KEY", ""),
    )
    print(f"✅ Generated dynamic Docker runtime environment: {env_path}")

    # 5. Validate Terraform configuration
    val = actuator.validate()
    if val["success"]:
        print("✅ Terraform configuration validation: PASSED")
    else:
        print(f"❌ Terraform validation failed: {val['stderr']}")
        sys.exit(1)

    # 6. Check execution flag
    if args.prepare_only or not args.apply:
        print("\n" + "=" * 70)
        print("⏸️  PREPARATION COMPLETE (Staged without running).")
        print("   All configuration files, variables, and blueprints are ready.")
        print(f"   To apply when you are ready, run:")
        print(f"     python scripts/deploy_nodes.py --scenario={args.scenario} --apply")
        print("=" * 70)
        return

    # 7. Execute Live Apply
    print("\n⏳ Triggering live Terraform apply across nodes...")
    res = actuator.apply(auto_approve=True)
    if res["success"]:
        print("🎉 Successfully applied infrastructure across target nodes!")
        print(res["stdout"])
    else:
        print(f"❌ Terraform apply failed: {res['stderr']}")
        sys.exit(1)


if __name__ == "__main__":
    main()

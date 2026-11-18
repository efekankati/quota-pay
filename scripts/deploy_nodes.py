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

import os
import sys
import argparse
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.orchestrator.figaro_adapter import FigaroPlacementAdapter
from src.orchestrator.figaro_connector import FigaroConnector
from src.orchestrator.agent_orchestrator import AgenticOrchestrator
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
        "--prompt",
        type=str,
        default=None,
        help="Natural language prompt for Agentic AI Orchestrator",
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
    parser.add_argument(
        "--use-existing-edge",
        action="store_true",
        help="Manage existing Proxmox Container 101 via SSH while letting Terraform manage AWS nodes",
    )

    args = parser.parse_args()

    actuator = TerraformActuator(project_root=PROJECT_ROOT)
    actuator.load_root_dotenv()

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
    if args.prompt:
        print(f"   Operator Prompt : {args.prompt}")
    else:
        print(f"   Target Scenario : {args.scenario}")
    print(f"   Edge IP Node    : {args.edge_ip}")
    print(f"   Cloud IP Node   : {args.cloud_ip}")
    print(f"   FIGARO Mode     : {os.getenv('FIGARO_MODE', 'mock')}")
    print(f"   Execution Mode  : {'PREPARE ONLY (No Apply)' if args.prepare_only or not args.apply else 'LIVE APPLY'}")
    print("=" * 70)

    # 1. Generate Placement Plan (Agentic Prompt -> FIGARO -> Schema)
    if args.prompt:
        agent = AgenticOrchestrator(project_root=PROJECT_ROOT)
        agent_out = agent.plan_from_prompt(args.prompt)
        plan = agent_out["plan"]
        print(f"\n🤖 Agentic Reasoning ({agent_out['engine_used']}):")
        print(f"   {agent_out['reasoning']}")
        print(f"   Audit Report: {agent_out['report_path']}")
    elif os.getenv("FIGARO_MODE", "mock").strip().lower() != "mock":
        connector = FigaroConnector()
        plan = connector.solve()
    else:
        adapter = FigaroPlacementAdapter()
        plan = adapter.generate_mock_plan(scenario=args.scenario)

    print(f"\n📦 Generated Plan for scenario '{plan.scenario}':")
    for name, node in plan.nodes.items():
        print(f"   - Node '{name}' ({node.target_provider}): {node.cpu_cores} cores, {node.memory_mb}MB RAM -> {node.services}")

    # 2. Serialize Terraform vars
    tfvars_path = actuator.export_tfvars_json(plan, exclude_proxmox=args.use_existing_edge)
    print(f"\n✅ Serialized Terraform variables to: {tfvars_path}")

    # 3. Generate initial dynamic Docker environment
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
    existing_edge_flag = " --use-existing-edge" if args.use_existing_edge else ""
    if args.prepare_only or not args.apply:
        print("\n" + "=" * 70)
        print("⏸️  PREPARATION COMPLETE (Staged without running).")
        print("   All configuration files, variables, and blueprints are ready.")
        print("   To apply when you are ready, run:")
        print(f"     python scripts/deploy_nodes.py --scenario={plan.scenario}{existing_edge_flag} --apply")
        print("=" * 70)
        return

    # 7. Execute Live Apply & Closed-Loop Upstream Discovery
    if args.use_existing_edge and plan.scenario == "all_edge":
        print("\n⏳ Clearing AWS Terraform resources (switching to $0/hr All-Edge)...")
    else:
        print("\n⏳ Triggering live Terraform apply across nodes...")
    res = actuator.apply(auto_approve=True)
    if res["success"]:
        print("🎉 Successfully applied infrastructure across target nodes!")
        print(res["stdout"])

        live_ips = actuator.resolve_live_ips_from_topology(
            default_edge_ip=args.edge_ip,
            default_cloud_ip=args.cloud_ip,
        )
        print(f"\n🔄 Closed-loop IP discovery -> Edge: {live_ips['edge_ip']} | Cloud: {live_ips['cloud_ip']}")

        actuator.generate_placement_env(
            plan=plan,
            edge_ip=live_ips["edge_ip"],
            cloud_ip=live_ips["cloud_ip"],
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            supabase_url=os.getenv("SUPABASE_URL", "https://nnamvsnorjbsruwhkker.supabase.co"),
            supabase_anon_key=os.getenv("SUPABASE_ANON_KEY", ""),
        )
        proxy_url = (
            f"http://{live_ips['edge_ip']}"
            if plan.scenario == "all_edge"
            else f"http://{live_ips['cloud_ip']}:3000"
        )
        actuator.update_root_env_ai_proxy(proxy_url)

        published = actuator.publish_endpoints_to_supabase(
            scenario=plan.scenario,
            edge_ip=live_ips["edge_ip"],
            cloud_ip=live_ips["cloud_ip"],
        )
        print(f"   Supabase endpoint registry synced: {'YES' if published else 'SKIPPED (offline/no policy)'}")

        pve_host = os.getenv("PROXMOX_HOST", "192.168.178.125")
        synced = actuator.sync_edge_upstreams(pve_host=pve_host, scenario=plan.scenario)
        print(f"   Edge Caddy upstream synced: {'YES' if synced else 'SKIPPED (Proxmox unreachable)'}")

        aws_region = os.getenv("AWS_REGION", "eu-south-1")
        print("\n" + "=" * 70)
        print(f"🌐 DEMO ENDPOINTS ({plan.scenario.upper()}):")
        if plan.scenario == "all_edge":
            print(f"   App UI (Edge Caddy)   : http://{live_ips['edge_ip']}")
            print(f"   API Health            : http://{live_ips['edge_ip']}/api/health")
            print(f"   Proxmox Control Panel : https://{pve_host}:8006")
        elif plan.scenario == "hybrid":
            print(f"   App UI (Edge -> Cloud): http://{live_ips['edge_ip']}")
            print(f"   Ingress Health        : http://{live_ips['edge_ip']}/ingress-health")
            print(f"   AI Proxy Health (AWS) : http://{live_ips['cloud_ip']}:3000/api/health")
            print(f"   Proxmox Control Panel : https://{pve_host}:8006")
            print(f"   AWS EC2 Console       : https://{aws_region}.console.aws.amazon.com/ec2/home?region={aws_region}#Instances:")
        else:
            print(f"   App UI (AWS Caddy)    : http://{live_ips['cloud_ip']}")
            print(f"   Ingress Health        : http://{live_ips['cloud_ip']}/ingress-health")
            print(f"   AI Proxy Health (AWS) : http://{live_ips['cloud_ip']}:3000/api/health")
            print(f"   AWS EC2 Console       : https://{aws_region}.console.aws.amazon.com/ec2/home?region={aws_region}#Instances:")
        print("=" * 70)
    else:
        print(f"❌ Terraform apply failed: {res['stderr']}")
        sys.exit(1)


if __name__ == "__main__":
    main()

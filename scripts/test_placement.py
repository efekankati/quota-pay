#!/usr/bin/env python3
"""
Test Suite & Verification for Quota Pay Modular Placement Orchestrator.
Validates:
  1. Pydantic schema validation for PlacementPlan, NodeAllocation, and PlacementDecision
  2. FIGARO adapter mock scenario generation ('all_edge', 'hybrid', 'cloud_burst')
  3. Parsing arbitrary raw FIGARO JSON payloads into normalized plans
  4. Serializing placement decisions into infra/terraform.tfvars.json
  5. Generating docker/.env.placement for dynamic container upstreams
  6. End-to-end verification via 'terraform validate'
"""

import sys
import json
from pathlib import Path

# Add project root to sys.path so src.orchestrator can be imported directly
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from src.orchestrator.schema import (
    PlacementPlan,
    NodeAllocation,
    TargetProvider,
    ServiceType,
)
from src.orchestrator.figaro_adapter import FigaroPlacementAdapter
from src.orchestrator.actuator import TerraformActuator


def print_banner(text: str):
    print("\n" + "=" * 70)
    print(f"🧪 {text}")
    print("=" * 70)


def test_mock_scenarios():
    print_banner("TEST 1: FIGARO Mock Scenarios Generation")

    adapter = FigaroPlacementAdapter()

    # 1. Hybrid Scenario (Edge Web + Cloud AI Proxy)
    hybrid_plan = adapter.generate_mock_plan("hybrid")
    assert hybrid_plan.scenario == "hybrid", "Scenario must be 'hybrid'"
    assert len(hybrid_plan.nodes) == 2, f"Expected 2 nodes in hybrid, got {len(hybrid_plan.nodes)}"
    assert "edge-frontend-01" in hybrid_plan.nodes, "Missing edge-frontend-01 node"
    assert "cloud-spot-ai-01" in hybrid_plan.nodes, "Missing cloud-spot-ai-01 node"

    edge_node = hybrid_plan.nodes["edge-frontend-01"]
    cloud_node = hybrid_plan.nodes["cloud-spot-ai-01"]

    assert edge_node.target_provider == TargetProvider.PROXMOX
    assert cloud_node.target_provider == TargetProvider.AWS
    assert ServiceType.FRONTEND in edge_node.services
    assert ServiceType.INGRESS in edge_node.services
    assert ServiceType.AI_PROXY in cloud_node.services

    print("  ✅ Scenario 'hybrid' generated and verified:")
    print(f"     - Edge node '{edge_node.target_node}': {edge_node.cpu_cores} cores, {edge_node.memory_mb}MB -> {edge_node.services}")
    print(f"     - Cloud node '{cloud_node.target_node}': {cloud_node.cpu_cores} cores, {cloud_node.memory_mb}MB -> {cloud_node.services}")

    # 2. All-Edge Scenario (Proxmox full stack)
    all_edge_plan = adapter.generate_mock_plan("all_edge")
    assert all_edge_plan.scenario == "all_edge"
    assert len(all_edge_plan.nodes) == 1
    single_edge = list(all_edge_plan.nodes.values())[0]
    assert single_edge.target_provider == TargetProvider.PROXMOX
    assert len(single_edge.services) == 3
    print("  ✅ Scenario 'all_edge' generated and verified (All 3 components on Proxmox VE)")

    # 3. Cloud-Burst Scenario (AWS Spot full stack)
    cloud_burst_plan = adapter.generate_mock_plan("cloud_burst")
    assert cloud_burst_plan.scenario == "cloud_burst"
    assert len(cloud_burst_plan.nodes) == 1
    single_cloud = list(cloud_burst_plan.nodes.values())[0]
    assert single_cloud.target_provider == TargetProvider.AWS
    assert len(single_cloud.services) == 3
    print("  ✅ Scenario 'cloud_burst' generated and verified (All 3 components on AWS Spot)")


def test_raw_figaro_parsing():
    print_banner("TEST 2: Parsing Raw FIGARO Algorithmic JSON Payload")

    raw_figaro_json = json.dumps({
        "decision_id": "figaro-dec-99812",
        "algorithm": "FIGARO-MILP-Optimizer-v2",
        "scenario": "hybrid",
        "estimated_cost_usd_hourly": 0.0075,
        "estimated_latency_ms": 11.2,
        "allocations": [
            {
                "node_id": "proxmox-vm-edge-01",
                "provider": "proxmox",
                "node_name": "pve-cluster-node-a",
                "cores": 2,
                "memory": 1024,
                "services": ["frontend", "ingress"]
            },
            {
                "node_id": "aws-spot-cloud-01",
                "provider": "aws-spot",
                "node_name": "eu-south-1a",
                "cores": 2,
                "memory": 1024,
                "services": ["ai-proxy"]
            }
        ]
    })

    adapter = FigaroPlacementAdapter()
    plan = adapter.parse_output(raw_figaro_json)

    assert plan.scenario == "hybrid"
    assert len(plan.nodes) == 2
    assert "proxmox-vm-edge-01" in plan.nodes
    assert "aws-spot-cloud-01" in plan.nodes

    p_node = plan.nodes["proxmox-vm-edge-01"]
    assert p_node.target_provider == TargetProvider.PROXMOX
    assert p_node.target_node == "pve-cluster-node-a"
    assert ServiceType.FRONTEND in p_node.services
    assert ServiceType.INGRESS in p_node.services

    a_node = plan.nodes["aws-spot-cloud-01"]
    assert a_node.target_provider == TargetProvider.AWS
    assert ServiceType.AI_PROXY in a_node.services

    print("  ✅ Successfully normalized raw FIGARO payload into PlacementPlan:")
    print(f"     - Decision algorithm: {plan.metadata.get('algorithm')}")
    print(f"     - Estimated cost: ${plan.metadata.get('estimated_cost_usd_hourly')}/hr")
    print(f"     - Estimated latency: {plan.metadata.get('estimated_latency_ms')}ms")


def test_actuator_and_terraform_validation():
    print_banner("TEST 3: Actuator Serialization & Terraform Validation")

    actuator = TerraformActuator(REPO_ROOT)
    adapter = FigaroPlacementAdapter()

    # Generate hybrid placement plan
    plan = adapter.generate_mock_plan("hybrid")

    # 1. Export terraform.tfvars.json
    tfvars_path = actuator.export_tfvars_json(plan)
    assert tfvars_path.exists(), f"File {tfvars_path} was not created"
    print(f"  ✅ Serialized terraform.tfvars.json to: {tfvars_path}")

    with open(tfvars_path, "r", encoding="utf-8") as f:
        tfvars_data = json.load(f)

    assert "placement_plan" in tfvars_data, "Missing 'placement_plan' top-level key"
    assert "edge-frontend-01" in tfvars_data["placement_plan"]
    assert "cloud-spot-ai-01" in tfvars_data["placement_plan"]

    # 2. Generate docker/.env.placement
    env_path = actuator.generate_placement_env(
        plan=plan,
        edge_ip="192.168.1.50",
        cloud_ip="15.161.41.185",
        gemini_api_key="mock-gemini-key",
        supabase_anon_key="mock-anon-key"
    )
    assert env_path.exists(), f"File {env_path} was not created"
    print(f"  ✅ Generated dynamic docker/.env.placement to: {env_path}")

    # 3. Execute Terraform Validation
    print("  ⏳ Running 'terraform validate' on root infra module...")
    val_res = actuator.validate()
    print(f"     Command: {val_res['command']}")
    if not val_res["success"]:
        print(f"❌ Terraform validate failed:\n{val_res['stderr']}\n{val_res['stdout']}")
        sys.exit(1)

    print("  ✅ Terraform validate passed with 0 errors!")
    print(f"     Output: {val_res['stdout']}")

    # 4. Execute Terraform Plan (Dry-Run Blueprint Verification)
    print("  ⏳ Running 'terraform plan' with generated terraform.tfvars.json...")
    plan_res = actuator.plan("terraform.tfvars.json")
    print(f"     Command: {plan_res['command']}")
    if not plan_res["success"]:
        print(f"❌ Terraform plan failed:\n{plan_res['stderr']}\n{plan_res['stdout']}")
        sys.exit(1)

    print("  ✅ Terraform plan passed with 0 errors!")
    # Check that both edge and cloud nodes were planned
    assert "module.proxmox_nodes[\"edge-frontend-01\"]" in plan_res["stdout"], "Plan missing Proxmox edge node"
    assert "module.aws_spot_nodes[\"cloud-spot-ai-01\"]" in plan_res["stdout"], "Plan missing AWS cloud node"
    print("     - Proxmox edge node planned: module.proxmox_nodes[\"edge-frontend-01\"] ✅")
    print("     - AWS Spot cloud node planned: module.aws_spot_nodes[\"cloud-spot-ai-01\"] ✅")


def main():
    print("=" * 70)
    print("🚀 RUNNING QUOTA PAY PLACEMENT & ORCHESTRATION TEST SUITE")
    print("=" * 70)

    try:
        test_mock_scenarios()
        test_raw_figaro_parsing()
        test_actuator_and_terraform_validation()

        print("\n" + "=" * 70)
        print("🎉 ALL PLACEMENT ORCHESTRATION TESTS PASSED WITH 100% SUCCESS!")
        print("=" * 70)
    except AssertionError as err:
        print(f"\n❌ Assertion failed: {err}")
        sys.exit(1)
    except Exception as err:
        print(f"\n❌ Unexpected error: {err}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

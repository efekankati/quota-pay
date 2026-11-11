"""
FIGARO Placement Adapter for Quota Pay.
Acts as a decoupled translation bridge between external FIGARO algorithmic
decisions and the concrete PlacementPlan schema.
"""

from __future__ import annotations
import json
from typing import Dict, Any, Union
from datetime import datetime, timezone
from .schema import (
    PlacementPlan,
    NodeAllocation,
    PlacementDecision,
    TargetProvider,
    ServiceType,
)


class FigaroPlacementAdapter:
    """
    Decoupled adapter translating FIGARO placement decisions into standard
    multi-node PlacementPlan specifications.
    """

    SERVICE_ALIAS_MAP: Dict[str, ServiceType] = {
        "frontend": ServiceType.FRONTEND,
        "web": ServiceType.FRONTEND,
        "quota-web-frontend": ServiceType.FRONTEND,
        "web-frontend": ServiceType.FRONTEND,
        "ai-proxy": ServiceType.AI_PROXY,
        "ai": ServiceType.AI_PROXY,
        "quota-ai-proxy": ServiceType.AI_PROXY,
        "backend": ServiceType.AI_PROXY,
        "ingress": ServiceType.INGRESS,
        "quota-ingress": ServiceType.INGRESS,
        "caddy": ServiceType.INGRESS,
        "gateway": ServiceType.INGRESS,
    }

    PROVIDER_ALIAS_MAP: Dict[str, TargetProvider] = {
        "proxmox": TargetProvider.PROXMOX,
        "pve": TargetProvider.PROXMOX,
        "edge": TargetProvider.PROXMOX,
        "local": TargetProvider.PROXMOX,
        "aws": TargetProvider.AWS,
        "cloud": TargetProvider.AWS,
        "spot": TargetProvider.AWS,
        "aws-spot": TargetProvider.AWS,
    }

    @classmethod
    def normalize_service(cls, name: str) -> ServiceType:
        key = name.strip().lower()
        if key in cls.SERVICE_ALIAS_MAP:
            return cls.SERVICE_ALIAS_MAP[key]
        raise ValueError(f"Unknown service identifier: '{name}'. Supported: {list(cls.SERVICE_ALIAS_MAP.keys())}")

    @classmethod
    def normalize_provider(cls, name: str) -> TargetProvider:
        key = name.strip().lower()
        if key in cls.PROVIDER_ALIAS_MAP:
            return cls.PROVIDER_ALIAS_MAP[key]
        raise ValueError(f"Unknown target provider: '{name}'. Supported: {list(cls.PROVIDER_ALIAS_MAP.keys())}")

    @classmethod
    def parse_output(cls, raw_figaro_output: Union[dict, str, PlacementDecision]) -> PlacementPlan:
        """
        Normalizes arbitrary FIGARO decision payloads into a strict PlacementPlan.
        Accepts:
          - A JSON string
          - A raw dictionary with 'nodes', 'allocations', or 'plan'
          - A validated PlacementDecision model
        """
        if isinstance(raw_figaro_output, str):
            try:
                data = json.loads(raw_figaro_output)
            except json.JSONDecodeError as err:
                raise ValueError(f"Invalid JSON provided to parse_output: {err}") from err
        elif isinstance(raw_figaro_output, PlacementDecision):
            data = raw_figaro_output.model_dump()
        elif isinstance(raw_figaro_output, dict):
            data = raw_figaro_output
        else:
            raise TypeError(f"Unsupported payload type: {type(raw_figaro_output)}")

        scenario = data.get("scenario", "hybrid")
        nodes_dict: Dict[str, NodeAllocation] = {}

        # Format 1: Direct 'nodes' map
        if "nodes" in data and isinstance(data["nodes"], dict):
            for node_id, raw_node in data["nodes"].items():
                provider = cls.normalize_provider(raw_node.get("target_provider") or raw_node.get("provider", "aws"))
                services = [cls.normalize_service(s) for s in raw_node.get("services", [])]
                nodes_dict[node_id] = NodeAllocation(
                    target_provider=provider,
                    target_node=raw_node.get("target_node") or raw_node.get("node_name"),
                    cpu_cores=int(raw_node.get("cpu_cores") or raw_node.get("cores", 2)),
                    memory_mb=int(raw_node.get("memory_mb") or raw_node.get("memory", 1024)),
                    services=services,
                    compose_target=raw_node.get("compose_target"),
                    ip_address=raw_node.get("ip_address"),
                    metadata=raw_node.get("metadata", {}),
                )

        # Format 2: Array of 'allocations' (typical optimizer list format)
        elif "allocations" in data and isinstance(data["allocations"], list):
            for idx, alloc in enumerate(data["allocations"]):
                node_id = alloc.get("node_id") or f"node-{idx + 1}"
                provider = cls.normalize_provider(alloc.get("target_provider") or alloc.get("provider", "aws"))
                raw_services = alloc.get("services", [])
                if isinstance(raw_services, str):
                    raw_services = [raw_services]
                services = [cls.normalize_service(s) for s in raw_services]
                nodes_dict[node_id] = NodeAllocation(
                    target_provider=provider,
                    target_node=alloc.get("target_node") or alloc.get("node_name"),
                    cpu_cores=int(alloc.get("cpu_cores") or alloc.get("cores", 2)),
                    memory_mb=int(alloc.get("memory_mb") or alloc.get("memory", 1024)),
                    services=services,
                    compose_target=alloc.get("compose_target"),
                    ip_address=alloc.get("ip_address"),
                    metadata=alloc.get("metadata", {}),
                )
        else:
            raise ValueError("FIGARO payload must contain either 'nodes' dict or 'allocations' list.")

        return PlacementPlan(
            version="1.0.0",
            scenario=scenario,
            nodes=nodes_dict,
            metadata={
                "algorithm": data.get("algorithm", "FIGARO-Orchestrator"),
                "estimated_cost_usd_hourly": data.get("estimated_cost_usd_hourly", 0.0),
                "estimated_latency_ms": data.get("estimated_latency_ms", 0.0),
            },
            created_at=data.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def generate_mock_plan(cls, scenario: str = "hybrid") -> PlacementPlan:
        """
        Generates pre-configured, production-grade mock scenarios for local testing,
        benchmarking, and CI verification before FIGARO is live.

        Scenarios:
          - 'all_edge': Everything placed on Proxmox VE (Edge).
          - 'hybrid': Quota Web Frontend + Ingress on Proxmox; Quota AI Proxy on AWS Spot.
          - 'cloud_burst': Everything placed on AWS Spot (Cloud).
        """
        scenario_key = scenario.strip().lower()

        if scenario_key in ("all_edge", "edge", "scenario_a"):
            nodes = {
                "edge-primary": NodeAllocation(
                    target_provider=TargetProvider.PROXMOX,
                    target_node="pve",
                    cpu_cores=4,
                    memory_mb=2048,
                    services=[
                        ServiceType.INGRESS,
                        ServiceType.FRONTEND,
                        ServiceType.AI_PROXY,
                    ],
                    compose_target="docker-compose.edge.yml",
                    metadata={"role": "unified-edge-node", "zone": "local-lan"},
                )
            }
            return PlacementPlan(
                scenario="all_edge",
                nodes=nodes,
                metadata={
                    "description": "All components placed on local Proxmox VE (zero cloud cost)",
                    "estimated_cost_usd_hourly": 0.0,
                    "estimated_latency_ms": 2.0,
                },
            )

        if scenario_key in ("hybrid", "default", "scenario_b"):
            nodes = {
                "edge-frontend-01": NodeAllocation(
                    target_provider=TargetProvider.PROXMOX,
                    target_node="pve",
                    cpu_cores=2,
                    memory_mb=1024,
                    services=[
                        ServiceType.INGRESS,
                        ServiceType.FRONTEND,
                    ],
                    compose_target="docker-compose.edge.yml",
                    metadata={"role": "edge-ui-gateway", "zone": "local-lan"},
                ),
                "cloud-spot-ai-01": NodeAllocation(
                    target_provider=TargetProvider.AWS,
                    target_node="eu-south-1a",
                    cpu_cores=2,
                    memory_mb=1024,
                    services=[
                        ServiceType.AI_PROXY,
                    ],
                    compose_target="docker-compose.cloud.yml",
                    metadata={"role": "cloud-ai-accelerator", "instance_type": "t3.small"},
                ),
            }
            return PlacementPlan(
                scenario="hybrid",
                nodes=nodes,
                metadata={
                    "description": "Hybrid split: Web & Ingress on Edge, Gemini AI Proxy on AWS Spot",
                    "estimated_cost_usd_hourly": 0.005,
                    "estimated_latency_ms": 15.0,
                },
            )

        if scenario_key in ("cloud_burst", "cloud", "aws", "scenario_c"):
            nodes = {
                "cloud-burst-01": NodeAllocation(
                    target_provider=TargetProvider.AWS,
                    target_node="eu-south-1a",
                    cpu_cores=2,
                    memory_mb=2048,
                    services=[
                        ServiceType.INGRESS,
                        ServiceType.FRONTEND,
                        ServiceType.AI_PROXY,
                    ],
                    compose_target="docker-compose.cloud.yml",
                    metadata={"role": "cloud-full-stack", "instance_type": "t3.small"},
                )
            }
            return PlacementPlan(
                scenario="cloud_burst",
                nodes=nodes,
                metadata={
                    "description": "Cloud burst: full Quota Pay application hosted on AWS Spot",
                    "estimated_cost_usd_hourly": 0.015,
                    "estimated_latency_ms": 25.0,
                },
            )

        raise ValueError(
            f"Unknown scenario '{scenario}'. Supported: 'all_edge', 'hybrid', 'cloud_burst'"
        )

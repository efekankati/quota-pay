"""
Strict, Typed Schema Contract for Quota Pay Placement & Infrastructure Orchestration.
Decouples external FIGARO algorithm decisions from Terraform and Docker runtimes.
"""

from __future__ import annotations
from enum import Enum
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict, field_validator


class TargetProvider(str, Enum):
    PROXMOX = "proxmox"
    AWS = "aws"


class ServiceType(str, Enum):
    FRONTEND = "quota-web-frontend"
    AI_PROXY = "quota-ai-proxy"
    INGRESS = "quota-ingress"


class ServiceAssignment(BaseModel):
    """Component assignment details within a target compute node."""
    model_config = ConfigDict(use_enum_values=True)

    service_name: ServiceType
    container_port: int
    host_port: Optional[int] = None
    environment: Dict[str, str] = Field(default_factory=dict)


class NodeAllocation(BaseModel):
    """Compute specification and service mapping for a physical or virtual node."""
    model_config = ConfigDict(use_enum_values=True)

    target_provider: TargetProvider
    target_node: Optional[str] = Field(
        default=None,
        description="Specific host node name (e.g. pve for Proxmox cluster, or AWS AZ)"
    )
    cpu_cores: int = Field(ge=1, le=64, description="Virtual or physical CPU cores")
    memory_mb: int = Field(ge=256, le=131072, description="RAM in megabytes")
    disk_gb: int = Field(default=8, ge=4, le=2048, description="Root disk size in gigabytes")
    virtualization_type: str = Field(
        default="lxc",
        description="Proxmox virtualization mode: 'lxc' (nested-VT-x safe default) or 'qemu'",
    )
    enable_firewall: bool = Field(
        default=True,
        description="Enable Proxmox VE default-drop ingress firewall on this node",
    )
    allowed_ports: List[int] = Field(
        default_factory=lambda: [80, 443],
        description="Inbound TCP service ports allowed through the node firewall",
    )
    services: List[ServiceType] = Field(
        min_length=1,
        description="Services placed on this compute node"
    )
    compose_target: Optional[str] = Field(
        default=None,
        description="Target docker-compose profile (e.g. docker-compose.edge.yml)"
    )
    ip_address: Optional[str] = Field(
        default=None,
        description="Observed or assigned IPv4 address"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("compose_target", mode="before")
    @classmethod
    def set_default_compose_target(cls, v: Optional[str], info) -> str:
        if v:
            return v
        provider = info.data.get("target_provider")
        if provider == TargetProvider.PROXMOX or provider == "proxmox":
            return "docker-compose.edge.yml"
        return "docker-compose.cloud.yml"


class PlacementPlan(BaseModel):
    """
    Standardized, multi-node placement blueprint ready for direct serialization
    into Terraform variables and Docker Compose upstreams.
    """
    model_config = ConfigDict(use_enum_values=True)

    version: str = "1.0.0"
    scenario: str = Field(
        default="hybrid",
        description="Placement scenario identifier: hybrid | all_edge | cloud_burst"
    )
    nodes: Dict[str, NodeAllocation] = Field(
        description="Map of node ID identifiers to their compute & service allocations"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_terraform_vars(self, enable_aws: Optional[bool] = None) -> Dict[str, Any]:
        """
        Serializes the plan into the exact HCL type definition expected by
        variable 'placement_plan' in infra/main.tf.
        """
        plan_dict: Dict[str, Any] = {}
        has_aws = False
        for node_id, node in self.nodes.items():
            provider_val = node.target_provider if isinstance(node.target_provider, str) else node.target_provider.value
            if provider_val == TargetProvider.AWS.value:
                has_aws = True
            plan_dict[node_id] = {
                "target_provider": provider_val,
                "target_node": node.target_node,
                "cpu_cores": node.cpu_cores,
                "memory_mb": node.memory_mb,
                "disk_gb": node.disk_gb,
                "virtualization_type": node.virtualization_type,
                "enable_firewall": node.enable_firewall,
                "allowed_ports": list(node.allowed_ports),
                "services": [
                    s if isinstance(s, str) else s.value for s in node.services
                ],
            }
        resolved_enable_aws = has_aws if enable_aws is None else bool(enable_aws)
        return {
            "enable_aws": resolved_enable_aws,
            "placement_plan": plan_dict,
        }


class PlacementDecision(BaseModel):
    """
    High-level contract representing the raw output from FIGARO or external
    placement optimization engines.
    """
    model_config = ConfigDict(use_enum_values=True)

    decision_id: str
    algorithm: str = "FIGARO-Orchestrator"
    objective: str = "min_latency_and_cost"
    scenario: str
    allocations: List[Dict[str, Any]]
    estimated_cost_usd_hourly: float = 0.005
    estimated_latency_ms: float = 12.5
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    notes: Optional[str] = None


class OptimizationConstraints(BaseModel):
    """Constraints passed into the FIGARO solver or Agentic Orchestrator."""
    model_config = ConfigDict(use_enum_values=True)

    max_hourly_budget_usd: float = Field(default=0.015, ge=0.0)
    max_latency_ms: float = Field(default=50.0, ge=0.0)
    prefer_edge: bool = True
    allow_cloud_burst: bool = True
    required_services: List[ServiceType] = Field(
        default_factory=lambda: [
            ServiceType.INGRESS,
            ServiceType.FRONTEND,
            ServiceType.AI_PROXY,
        ]
    )
    objective: str = "min_latency_and_cost"


class ClusterTelemetrySnapshot(BaseModel):
    """Live edge, cloud, and FinOps telemetry fed into placement optimization."""
    model_config = ConfigDict(use_enum_values=True)

    proxmox_reachable: bool = False
    proxmox_host: str = "192.168.178.125"
    proxmox_available_cores: int = 4
    proxmox_available_memory_mb: int = 2048
    aws_region: str = "eu-south-1"
    aws_spot_hourly_usd: float = 0.005
    current_token_spend_usd: float = 0.0
    max_budget_usd: float = 5.00
    budget_remaining_usd: float = 5.00
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


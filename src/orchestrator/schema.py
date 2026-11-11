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

    def to_terraform_vars(self) -> Dict[str, Any]:
        """
        Serializes the plan into the exact HCL type definition expected by
        variable 'placement_plan' in infra/main.tf.
        """
        plan_dict: Dict[str, Any] = {}
        for node_id, node in self.nodes.items():
            plan_dict[node_id] = {
                "target_provider": node.target_provider,
                "target_node": node.target_node,
                "cpu_cores": node.cpu_cores,
                "memory_mb": node.memory_mb,
                "services": [
                    s if isinstance(s, str) else s.value for s in node.services
                ],
            }
        return {"placement_plan": plan_dict}


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

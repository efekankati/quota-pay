"""
Quota Pay — Modular Infrastructure Orchestration & Placement Bridge
Decoupled adapter contract connecting FIGARO placement decisions to multi-node
Proxmox VE (Edge) and AWS Spot (Cloud) container runtimes.
"""

from .schema import (
    PlacementPlan,
    NodeAllocation,
    ServiceAssignment,
    PlacementDecision,
    OptimizationConstraints,
    ClusterTelemetrySnapshot,
    TargetProvider,
    ServiceType,
)
from .figaro_adapter import FigaroPlacementAdapter
from .figaro_connector import FigaroConnector
from .agent_orchestrator import AgenticOrchestrator
from .actuator import TerraformActuator

__all__ = [
    "PlacementPlan",
    "NodeAllocation",
    "ServiceAssignment",
    "PlacementDecision",
    "OptimizationConstraints",
    "ClusterTelemetrySnapshot",
    "TargetProvider",
    "ServiceType",
    "FigaroPlacementAdapter",
    "FigaroConnector",
    "AgenticOrchestrator",
    "TerraformActuator",
]

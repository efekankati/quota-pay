"""
Executable Agentic AI Orchestrator for Quota Pay + FIGARO + Terraform.
Translates natural-language operator intent and live cluster telemetry into
validated OptimizationConstraints, PlacementDecision payloads, PlacementPlan
schemas, and Markdown audit trails in docs/last_agent_decision.md.
"""

from __future__ import annotations
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from .figaro_adapter import FigaroPlacementAdapter
from .figaro_connector import FigaroConnector, _read_root_dotenv
from .schema import (
    ClusterTelemetrySnapshot,
    OptimizationConstraints,
    PlacementDecision,
    PlacementPlan,
    ServiceType,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

SYSTEM_PROMPT = """SYSTEM PROMPT: Quota-FIGARO Autonomous Infrastructure Orchestrator

You are an Autonomous Cloud-Edge Infrastructure Agent managing the deployment of the Quota Pay platform across Proxmox VE (local edge) and AWS eu-south-1 (cloud Spot).

YOUR TOOLS & BRIDGE:
1. Telemetry Collector (`FigaroConnector.collect_live_telemetry`): Reads LAN/Proxmox reachability, AWS Spot rates (~$0.005/hr), and Supabase `ai_token_ledger` spend.
2. FIGARO Placement Adapter (`FigaroPlacementAdapter.parse_output`): Normalizes raw optimizer decisions into `PlacementPlan` (`src/orchestrator/schema.py`).
3. Terraform Actuator (`TerraformActuator`): Exports `infra/terraform.tfvars.json` and `docker/.env.placement`, runs `terraform validate` and `terraform plan` before any mutation.

STRICT OPERATING RULES:
- Mutate infrastructure topology strictly by synthesizing a valid `PlacementDecision` -> `PlacementPlan` -> `infra/terraform.tfvars.json`.
- Enforce the FinOps hard cap: total compute + AI token spend must stay strictly within `max_budget_usd` ($5.00).
- Choose `all_edge` when zero cloud cost ($0.00/hr) or local-only/campus execution is requested.
- Choose `cloud_burst` when Proxmox is offline or full public AWS execution is requested.
- Choose `hybrid` when edge UI/Ingress should run on Proxmox while AI receipt parsing scales on AWS Spot.
- Output ONLY valid JSON containing: `reasoning` (string), `constraints` (`OptimizationConstraints`), and `decision` (`PlacementDecision`)."""


class AgenticOrchestrator:
    """
    Agentic reasoning layer translating natural language deployment intent and
    live cluster telemetry into FIGARO placement decisions and audit reports.
    """

    def __init__(self, project_root: Optional[Path] = None) -> None:
        self.project_root = Path(project_root).resolve() if project_root else PROJECT_ROOT
        self.connector = FigaroConnector()

    @staticmethod
    def _get_gemini_api_key() -> str:
        dotenv = _read_root_dotenv()
        return (
            os.environ.get("GEMINI_API_KEY")
            or os.environ.get("EXPO_PUBLIC_GEMINI_API_KEY")
            or dotenv.get("GEMINI_API_KEY")
            or dotenv.get("EXPO_PUBLIC_GEMINI_API_KEY")
            or ""
        ).strip()

    @staticmethod
    def _deterministic_prompt_to_decision(
        prompt: str,
        telemetry: ClusterTelemetrySnapshot,
    ) -> Dict[str, Any]:
        """
        Deterministic NLU rules translating natural-language intent into strict
        OptimizationConstraints + PlacementDecision so demos and CI tests never block offline.
        """
        text = prompt.lower().strip()

        edge_keywords = (
            "$0",
            "0.00",
            "zero cost",
            "zero cloud",
            "all_edge",
            "all edge",
            "only edge",
            "edge only",
            "campus",
            "local only",
            "local edge",
            "no cloud",
            "proxmox only",
        )
        cloud_keywords = (
            "cloud_burst",
            "cloud burst",
            "all cloud",
            "only aws",
            "aws only",
            "proxmox off",
            "full cloud",
            "full aws",
        )

        if any(k in text for k in edge_keywords):
            scenario = "all_edge"
            constraints = OptimizationConstraints(
                max_hourly_budget_usd=0.0,
                max_latency_ms=10.0,
                prefer_edge=True,
                allow_cloud_burst=False,
                objective="zero_cloud_cost_edge_only",
            )
            reasoning = (
                "Operator requested zero cloud cost / local edge operation. "
                "Placed Ingress, Web Frontend, and AI Proxy on Proxmox VE (`pve`) "
                "so `has_aws_nodes` evaluates to false ($0.00/hr AWS spend)."
            )
            allocations = [
                {
                    "node_id": "edge-primary",
                    "target_provider": "proxmox",
                    "target_node": "pve",
                    "cpu_cores": 4,
                    "memory_mb": 2048,
                    "services": [
                        ServiceType.INGRESS.value,
                        ServiceType.FRONTEND.value,
                        ServiceType.AI_PROXY.value,
                    ],
                }
            ]
            est_cost = 0.0
            est_latency = 2.0
        elif any(k in text for k in cloud_keywords):
            scenario = "cloud_burst"
            constraints = OptimizationConstraints(
                max_hourly_budget_usd=0.02,
                max_latency_ms=50.0,
                prefer_edge=False,
                allow_cloud_burst=True,
                objective="max_availability_cloud_burst",
            )
            reasoning = (
                "Operator requested full AWS / Cloud Burst execution. "
                f"Placed all services on AWS `{telemetry.aws_region}` Spot compute "
                "to handle public internet traffic independently of local Proxmox."
            )
            allocations = [
                {
                    "node_id": "cloud-burst-01",
                    "target_provider": "aws",
                    "target_node": f"{telemetry.aws_region}a",
                    "cpu_cores": 2,
                    "memory_mb": 2048,
                    "services": [
                        ServiceType.INGRESS.value,
                        ServiceType.FRONTEND.value,
                        ServiceType.AI_PROXY.value,
                    ],
                }
            ]
            est_cost = 0.015
            est_latency = 25.0
        else:
            scenario = "hybrid"
            constraints = OptimizationConstraints(
                max_hourly_budget_usd=telemetry.aws_spot_hourly_usd,
                max_latency_ms=25.0,
                prefer_edge=True,
                allow_cloud_burst=True,
                objective="min_latency_and_cost",
            )
            reasoning = (
                "Selected hybrid Cloud-Edge placement: Quota Web Frontend and Caddy "
                "Ingress remain on local Proxmox VE for low-latency UI delivery, while "
                f"Quota AI Proxy scales on AWS Spot (`{telemetry.aws_region}a`) at ~${telemetry.aws_spot_hourly_usd:.3f}/hr."
            )
            allocations = [
                {
                    "node_id": "edge-frontend-01",
                    "target_provider": "proxmox",
                    "target_node": "pve",
                    "cpu_cores": 2,
                    "memory_mb": 1024,
                    "services": [
                        ServiceType.INGRESS.value,
                        ServiceType.FRONTEND.value,
                    ],
                },
                {
                    "node_id": "cloud-spot-ai-01",
                    "target_provider": "aws",
                    "target_node": f"{telemetry.aws_region}a",
                    "cpu_cores": 2,
                    "memory_mb": 1024,
                    "services": [
                        ServiceType.AI_PROXY.value,
                    ],
                },
            ]
            est_cost = telemetry.aws_spot_hourly_usd
            est_latency = 15.0

        decision = PlacementDecision(
            decision_id=f"figaro-{scenario}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            algorithm="Quota-Agentic-FIGARO-Bridge",
            objective=constraints.objective,
            scenario=scenario,
            allocations=allocations,
            estimated_cost_usd_hourly=est_cost,
            estimated_latency_ms=est_latency,
            notes=reasoning,
        )

        return {
            "reasoning": reasoning,
            "constraints": constraints.model_dump(),
            "decision": decision.model_dump(),
            "engine_used": "deterministic-nlu-fallback",
        }

    def _call_gemini_planner(
        self,
        prompt: str,
        telemetry: ClusterTelemetrySnapshot,
        api_key: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Invokes Gemini REST API with JSON structured output to convert operator intent
        plus live telemetry into OptimizationConstraints and a PlacementDecision.
        """
        schema_guide = {
            "reasoning": "Concise architectural explanation",
            "constraints": OptimizationConstraints.model_json_schema(),
            "decision": PlacementDecision.model_json_schema(),
        }
        user_content = (
            f"OPERATOR PROMPT:\n{prompt}\n\n"
            f"LIVE CLUSTER TELEMETRY:\n{json.dumps(telemetry.model_dump(), indent=2)}\n\n"
            f"TARGET JSON SCHEMA GUIDE:\n{json.dumps(schema_guide, indent=2)}\n\n"
            "Return strictly a single valid JSON object with keys: reasoning, constraints, decision. "
            "Each item in decision.allocations MUST include node_id, target_provider ('proxmox' or 'aws'), "
            "target_node ('pve' or 'eu-south-1a'), cpu_cores, memory_mb, and services "
            "(subset of ['quota-ingress', 'quota-web-frontend', 'quota-ai-proxy'])."
        )

        models = ("gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash")
        for model in models:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                f"?key={api_key}"
            )
            body = json.dumps({
                "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": user_content}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.1,
                },
            }).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    if resp.status != 200:
                        continue
                    raw_resp = json.loads(resp.read().decode("utf-8"))
                    parts = (
                        raw_resp.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", [])
                    )
                    text_out = ""
                    for part in parts:
                        if not part.get("thought") and part.get("text"):
                            text_out = part["text"]
                            break
                    if not text_out:
                        continue
                    parsed = json.loads(text_out)
                    if isinstance(parsed, dict) and "decision" in parsed:
                        parsed["engine_used"] = f"gemini:{model}"
                        return parsed
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, Exception):
                continue

        return None

    def _write_audit_report(
        self,
        prompt: str,
        telemetry: ClusterTelemetrySnapshot,
        constraints: OptimizationConstraints,
        decision: PlacementDecision,
        plan: PlacementPlan,
        reasoning: str,
        engine_used: str,
        output_report_path: Optional[Path] = None,
    ) -> Path:
        report_path = output_report_path or (self.project_root / "docs" / "last_agent_decision.md")
        report_path.parent.mkdir(parents=True, exist_ok=True)

        tfvars_payload = json.dumps(plan.to_terraform_vars(), indent=2)
        md = f"""# Quota Pay — Agentic Orchestrator Decision Audit

**Generated At:** `{datetime.now(timezone.utc).isoformat()}`  
**Reasoning Engine:** `{engine_used}`  
**Selected Scenario:** `{plan.scenario}`  

---

## 1. Operator Prompt
> {prompt}

---

## 2. Agent Reasoning
{reasoning}

---

## 3. Live Cluster Telemetry Snapshot
```json
{json.dumps(telemetry.model_dump(), indent=2)}
```

---

## 4. Extracted Optimization Constraints
```json
{json.dumps(constraints.model_dump(), indent=2)}
```

---

## 5. Synthesized FIGARO Placement Decision
```json
{json.dumps(decision.model_dump(), indent=2)}
```

---

## 6. Serialized Terraform Inputs (`infra/terraform.tfvars.json`)
```json
{tfvars_payload}
```
"""
        report_path.write_text(md, encoding="utf-8")
        return report_path

    def plan_from_prompt(
        self,
        prompt: str,
        telemetry: Optional[ClusterTelemetrySnapshot] = None,
        use_live_llm: bool = True,
        output_report_path: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """
        End-to-end agentic planning workflow:
          Prompt + Telemetry -> LLM/NLU -> Constraints & Decision -> PlacementPlan -> Audit Report.
        """
        active_telemetry = telemetry or self.connector.collect_live_telemetry()
        raw_result: Optional[Dict[str, Any]] = None

        if use_live_llm:
            api_key = self._get_gemini_api_key()
            if api_key:
                candidate = self._call_gemini_planner(prompt, active_telemetry, api_key)
                if candidate is not None:
                    # Validate LLM decision shape before accepting
                    try:
                        OptimizationConstraints(**candidate.get("constraints", {}))
                        dec_obj = PlacementDecision(**candidate["decision"])
                        FigaroPlacementAdapter.parse_output(dec_obj)
                        raw_result = candidate
                    except Exception:
                        raw_result = None

        if raw_result is None:
            raw_result = self._deterministic_prompt_to_decision(prompt, active_telemetry)

        constraints = OptimizationConstraints(**raw_result.get("constraints", {}))
        decision = PlacementDecision(**raw_result["decision"])
        plan = FigaroPlacementAdapter.parse_output(decision)

        # Allow external FIGARO backend to refine when FIGARO_MODE != mock
        if os.environ.get("FIGARO_MODE", "mock").strip().lower() != "mock":
            plan = self.connector.solve(constraints=constraints, telemetry=active_telemetry)

        reasoning = str(raw_result.get("reasoning") or decision.notes or "Automated placement")
        engine_used = str(raw_result.get("engine_used", "deterministic-nlu-fallback"))

        report_path = self._write_audit_report(
            prompt=prompt,
            telemetry=active_telemetry,
            constraints=constraints,
            decision=decision,
            plan=plan,
            reasoning=reasoning,
            engine_used=engine_used,
            output_report_path=output_report_path,
        )

        return {
            "prompt": prompt,
            "telemetry": active_telemetry,
            "constraints": constraints,
            "decision": decision,
            "plan": plan,
            "reasoning": reasoning,
            "engine_used": engine_used,
            "report_path": report_path,
        }

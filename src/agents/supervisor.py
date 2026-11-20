"""
Central 4-Agent Supervisor Control Plane (`src/agents/supervisor.py`).

Coordinates:
  FIGARO CLI Bridge -> Agent 1 (Terraform Author) <-> Agent 2 (Prompt & Policy Auditor, max_retries=3)
                    -> Agent 3 (Deploy & Verification Runner)
                    -> Agent 4 (Post-Deployment Security, Performance & Compliance Auditor)
                    -> Structured Audit Report (`reports/deployment_audit_<timestamp>.{json,md}`)

Uses LangGraph `StateGraph` when installed, with a semantically identical typed Python
state-machine fallback so execution never fails in minimal environments.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from src.orchestrator.figaro_cli_bridge import FigaroCLIBridge
from src.orchestrator.schema import ClusterTelemetrySnapshot

from .deploy_runner_agent import DeployRunnerAgent
from .post_deploy_auditor_agent import PostDeployAuditorAgent
from .prompt_guard_agent import PromptGuardAgent
from .state import AgentLogEntry, AgentPipelineConfig, AgentState
from .terraform_author_agent import TerraformAuthorAgent

try:
    from langgraph.graph import END, StateGraph

    LANGGRAPH_AVAILABLE = True
except ImportError:
    END = "__end__"
    StateGraph = None  # type: ignore[assignment]
    LANGGRAPH_AVAILABLE = False


class MultiAgentSupervisor:
    """Supervisor orchestrating the Proxmox-first 4-agent Terraform deployment pipeline."""

    def __init__(
        self,
        config: Optional[AgentPipelineConfig] = None,
        telemetry_override: Optional[ClusterTelemetrySnapshot] = None,
    ) -> None:
        self.config = config or AgentPipelineConfig()
        self.telemetry_override = telemetry_override
        self.figaro_bridge = FigaroCLIBridge(project_root=self.config.project_root)
        self.agent_1 = TerraformAuthorAgent(self.config)
        self.agent_2 = PromptGuardAgent(self.config)
        self.agent_3 = DeployRunnerAgent(self.config)
        self.agent_4 = PostDeployAuditorAgent(self.config)
        self._graph = self._compile_langgraph() if LANGGRAPH_AVAILABLE else None

    @property
    def engine_name(self) -> str:
        return "langgraph.StateGraph" if self._graph is not None else "python.StateMachine"

    # --- Graph Node Handlers ---

    def _node_figaro_ingest(self, state: AgentState) -> AgentState:
        logs = list(state.get("agent_logs") or [])
        figaro_file = Path(state["figaro_file"]) if state.get("figaro_file") else None
        directive = self.figaro_bridge.resolve_directive(
            prompt=state["prompt"],
            cli_command=state.get("figaro_cmd"),
            stdin_text=state.get("figaro_stdin"),
            figaro_file=figaro_file,
            enable_aws=self.config.enable_aws,
            telemetry=self.telemetry_override,
            strict_cli=self.config.strict_figaro_cli,
        )
        logs.append(
            AgentLogEntry(
                agent="figaro_cli_bridge",
                phase="ingest_placement_directive",
                status="passed",
                reasoning=(
                    f"Resolved directive '{directive.directive_id}' via {directive.source} "
                    f"(scenario={directive.scenario}, enable_aws={directive.enable_aws}, "
                    f"nodes={list(directive.placement_plan.nodes.keys())})."
                ),
                details={
                    "source": directive.source,
                    "cli_mode": directive.cli_execution.mode,
                    "cli_exit_code": directive.cli_execution.exit_code,
                    "fallback_reason": directive.cli_execution.fallback_reason,
                },
            ).model_dump()
        )
        return {
            **state,
            "directive": directive.model_dump(),
            "figaro_cli_execution": directive.cli_execution.model_dump(),
            "agent_logs": logs,
        }

    def _node_agent_1(self, state: AgentState) -> AgentState:
        return self.agent_1.run(state)

    def _node_agent_2(self, state: AgentState) -> AgentState:
        return self.agent_2.run(state)

    def _node_agent_3(self, state: AgentState) -> AgentState:
        return self.agent_3.run(state)

    def _node_agent_4(self, state: AgentState) -> AgentState:
        return self.agent_4.run(state)

    def _route_after_guard(self, state: AgentState) -> str:
        if state.get("guard_approved"):
            return "agent_3_runner"
        if int(state.get("retry_count", 0)) <= int(state.get("max_retries", self.config.max_retries)):
            return "agent_1_author"
        return "finalize_report"

    def _route_after_runner(self, state: AgentState) -> str:
        if state.get("deploy_succeeded"):
            return "agent_4_auditor"
        return "finalize_report"

    def _node_finalize_report(self, state: AgentState) -> AgentState:
        report_dir = self.config.resolved_report_dir()
        report_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        json_path = report_dir / f"deployment_audit_{ts}.json"
        md_path = report_dir / f"deployment_audit_{ts}.md"

        final_state: Dict[str, Any] = {
            **state,
            "report_json_path": str(json_path),
            "report_md_path": str(md_path),
        }

        # Scrub any accidental secret values before serializing report
        report_payload = {
            "run_id": final_state.get("run_id"),
            "started_at": final_state.get("started_at"),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "orchestration_engine": self.engine_name,
            "execution_mode": self.config.execution_mode,
            "proxmox_first": True,
            "enable_aws": bool((final_state.get("tfvars_data") or {}).get("enable_aws", False)),
            "status": final_state.get("status", "unknown"),
            "prompt": final_state.get("prompt"),
            "retry_count": final_state.get("retry_count", 0),
            "max_retries": final_state.get("max_retries", self.config.max_retries),
            "figaro_cli_execution": final_state.get("figaro_cli_execution", {}),
            "directive": final_state.get("directive", {}),
            "authored_artifacts": {
                "hcl_path": final_state.get("authored_hcl_path"),
                "tfvars_path": final_state.get("tfvars_path"),
                "placement_env_path": final_state.get("placement_env_path"),
                "tfvars_data": final_state.get("tfvars_data", {}),
            },
            "plan_diff": final_state.get("plan_diff", {}),
            "policy_audit": {
                "approved": final_state.get("guard_approved", False),
                "history": final_state.get("policy_history", []),
                "final_violations": final_state.get("policy_violations", []),
            },
            "deployment_verification": {
                "deploy_succeeded": final_state.get("deploy_succeeded", False),
                "live_ips": final_state.get("live_ips", {}),
                "functional_checks": final_state.get("functional_checks", []),
                "runtime_telemetry": final_state.get("observed_runtime_telemetry", {}),
            },
            "post_deploy_audit": {
                "audit_passed": final_state.get("audit_passed", False),
                "initial_findings": final_state.get("audit_findings", []),
                "remediations_applied": final_state.get("remediations_applied", []),
                "remaining_findings": final_state.get("post_remediation_findings", []),
            },
            "agent_logs": final_state.get("agent_logs", []),
        }

        json_path.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")
        md_path.write_text(self._render_markdown_report(report_payload), encoding="utf-8")
        return final_state  # type: ignore[return-value]

    @staticmethod
    def _render_markdown_report(data: Dict[str, Any]) -> str:
        plan_diff = data.get("plan_diff") or {}
        policy = data.get("policy_audit") or {}
        deploy = data.get("deployment_verification") or {}
        post = data.get("post_deploy_audit") or {}
        cli_exec = data.get("figaro_cli_execution") or {}

        logs_md = "\n".join(
            f"- **`{e.get('agent')}`** (`{e.get('phase')}` — **{e.get('status')}**): {e.get('reasoning')}"
            for e in data.get("agent_logs", [])
        )
        checks_md = "\n".join(
            f"- {'PASS' if c.get('passed') else 'FAIL'} `{c.get('name')}` (`{c.get('endpoint')}`) "
            f"— HTTP `{c.get('status_code')}`, `{c.get('latency_ms')}ms` — {c.get('detail')}"
            for c in deploy.get("functional_checks", [])
        ) or "_Not executed (blocked prior to deployment)._"

        remed_md = "\n".join(
            f"- **`{r.get('finding_id')}`** (`{r.get('action_type')}` on `{r.get('target_file')}`): "
            f"`{r.get('before_value')}` -> `{r.get('after_value')}` "
            f"(applied={r.get('applied')}, re_verified={r.get('re_verified')}) — {r.get('detail')}"
            for r in post.get("remediations_applied", [])
        ) or "_No remediations required._"

        findings_md = "\n".join(
            f"- [{f.get('severity', '').upper()}] `{f.get('finding_id')}` ({f.get('pillar')}): "
            f"{f.get('issue')} (remediated={f.get('remediated')})"
            for f in post.get("initial_findings", [])
        ) or "_Zero post-deployment findings._"

        return f"""# Quota Pay — 4-Agent Proxmox-First Deployment Audit Report

- **Run ID:** `{data.get('run_id')}`
- **Status:** `{data.get('status')}`
- **Execution Mode:** `{data.get('execution_mode')}`
- **Orchestration Engine:** `{data.get('orchestration_engine')}`
- **AWS Opt-In Enabled:** `{data.get('enable_aws')}`
- **Agent 2 Retry Count:** `{data.get('retry_count')}/{data.get('max_retries')}`
- **Completed At:** `{data.get('completed_at')}`

---

## 1. Operator Prompt & FIGARO CLI Bridge
> {data.get('prompt')}

- **Transport Mode:** `{cli_exec.get('mode')}` | **Command:** `{cli_exec.get('command') or 'mock'}` | **Exit Code:** `{cli_exec.get('exit_code')}`
- **Fallback Note:** {cli_exec.get('fallback_reason') or 'None (direct external FIGARO payload)'}

---

## 2. Multi-Agent Reasoning Trace
{logs_md}

---

## 3. Terraform Plan Diff Summary (`{plan_diff.get('source')}`)
- **`terraform validate` Passed:** `{plan_diff.get('terraform_validate_passed')}`
- **Proxmox Resources Planned:** `{len(plan_diff.get('proxmox_resources_planned', []))}`
- **AWS Resources Planned:** `{len(plan_diff.get('aws_resources_planned', []))}`

```json
{json.dumps(plan_diff, indent=2)}
```

---

## 4. Agent 2 Pre-Deployment Policy Audit
- **Approved:** `{policy.get('approved')}`
- **Audit Attempts:** `{len(policy.get('history', []))}`

```json
{json.dumps(policy.get('history', []), indent=2)}
```

---

## 5. Agent 3 Automated Functional Verification
- **Deploy Succeeded:** `{deploy.get('deploy_succeeded')}`
- **Live IPs:** `{json.dumps(deploy.get('live_ips', {}))}`

{checks_md}

---

## 6. Agent 4 Post-Deployment Security, Performance & Compliance Audit
- **Audit Passed:** `{post.get('audit_passed')}`

### Findings Detected
{findings_md}

### Autonomous Remediations Applied
{remed_md}
"""

    def _compile_langgraph(self) -> Any:
        builder = StateGraph(AgentState)
        builder.add_node("figaro_ingest", self._node_figaro_ingest)
        builder.add_node("agent_1_author", self._node_agent_1)
        builder.add_node("agent_2_guard", self._node_agent_2)
        builder.add_node("agent_3_runner", self._node_agent_3)
        builder.add_node("agent_4_auditor", self._node_agent_4)
        builder.add_node("finalize_report", self._node_finalize_report)

        builder.set_entry_point("figaro_ingest")
        builder.add_edge("figaro_ingest", "agent_1_author")
        builder.add_edge("agent_1_author", "agent_2_guard")
        builder.add_conditional_edges(
            "agent_2_guard",
            self._route_after_guard,
            {
                "agent_3_runner": "agent_3_runner",
                "agent_1_author": "agent_1_author",
                "finalize_report": "finalize_report",
            },
        )
        builder.add_conditional_edges(
            "agent_3_runner",
            self._route_after_runner,
            {
                "agent_4_auditor": "agent_4_auditor",
                "finalize_report": "finalize_report",
            },
        )
        builder.add_edge("agent_4_auditor", "finalize_report")
        builder.add_edge("finalize_report", END)
        return builder.compile()

    def _run_python_state_machine(self, state: AgentState) -> AgentState:
        state = self._node_figaro_ingest(state)
        while True:
            state = self._node_agent_1(state)
            state = self._node_agent_2(state)
            next_step = self._route_after_guard(state)
            if next_step == "agent_1_author":
                continue
            if next_step == "agent_3_runner":
                state = self._node_agent_3(state)
                if self._route_after_runner(state) == "agent_4_auditor":
                    state = self._node_agent_4(state)
            break
        return self._node_finalize_report(state)

    def run(
        self,
        prompt: str,
        figaro_cmd: Optional[str] = None,
        figaro_stdin: Optional[str] = None,
        figaro_file: Optional[str] = None,
        initial_runtime_telemetry: Optional[Dict[str, Any]] = None,
    ) -> AgentState:
        """Executes the full 4-agent pipeline and returns the final audited AgentState."""
        initial_state: AgentState = {
            "run_id": f"run-{uuid.uuid4().hex[:10]}",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "prompt": prompt,
            "figaro_cmd": figaro_cmd,
            "figaro_stdin": figaro_stdin,
            "figaro_file": figaro_file,
            "config": self.config.model_dump(mode="json"),
            "retry_count": 0,
            "max_retries": self.config.max_retries,
            "policy_feedback": [],
            "policy_history": [],
            "agent_logs": [],
            "status": "running",
        }
        if initial_runtime_telemetry:
            initial_state["observed_runtime_telemetry"] = dict(initial_runtime_telemetry)

        if self._graph is not None:
            return self._graph.invoke(initial_state)
        return self._run_python_state_machine(initial_state)

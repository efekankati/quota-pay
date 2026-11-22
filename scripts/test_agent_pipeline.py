#!/usr/bin/env python3
"""
End-to-End & Unit Test Suite for the Proxmox-First 4-Agent Terraform Control Plane
and FIGARO External CLI Bridge (`scripts/test_agent_pipeline.py`).

Validates:
  1. FIGARO CLI Bridge: subprocess JSON-over-stdin/stdout, log-prefixed stdout,
     piped stdin, JSON file input, and graceful fallback when binary is missing.
  2. Proxmox-First 4-Agent LangGraph Supervisor dry-run (`enable_aws = false`),
     real `terraform validate` over authored `agent_generated.tf` + `terraform.tfvars.json`,
     and structured JSON + Markdown audit reports in `reports/`.
  3. Agent 2 -> Agent 1 Feedback & Self-Correction Loop (`max_retries = 3`):
     - Nested VT-x unsafe QEMU request auto-corrected to LXC
     - Unauthorized AWS node injected by external CLI auto-corrected to Proxmox VE ($0/hr)
     - Static rubric catches hardcoded secrets, exposed management ports, and 0.0.0.0/0 SSH
  4. Agent 4 Post-Deployment Security & Performance Auto-Remediation Loop:
     - Detects exposed ports, disabled firewall, SSH password auth, high latency/RAM pressure,
       and missing Caddy compression/caching/security headers; patches configs and re-validates.
  5. Optional AWS Opt-In (`enable_aws = True`) preserved without breaking default Proxmox-first behavior.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from src.agents import (
    LANGGRAPH_AVAILABLE,
    AgentEvent,
    AgentEventBus,
    AgentPipelineConfig,
    LiveSSEServerObserver,
    MultiAgentSupervisor,
    evaluate_pre_deploy_rubric,
)
from src.orchestrator.figaro_cli_bridge import FigaroCLIBridge
from src.orchestrator.schema import ClusterTelemetrySnapshot


def _banner(title: str) -> None:
    print("\n" + "=" * 74)
    print(f"🧪 {title}")
    print("=" * 74)


def _offline_telemetry() -> ClusterTelemetrySnapshot:
    return ClusterTelemetrySnapshot(
        proxmox_reachable=False,
        proxmox_host="192.168.178.125",
        proxmox_available_cores=4,
        proxmox_available_memory_mb=4096,
        aws_region="eu-south-1",
        aws_spot_hourly_usd=0.005,
        current_token_spend_usd=0.0,
        max_budget_usd=5.00,
        budget_remaining_usd=5.00,
    )


def test_1_figaro_cli_bridge() -> None:
    _banner("TEST 1: FIGARO External CLI Bridge (Subprocess, Stdin, File & Offline Fallback)")
    bridge = FigaroCLIBridge(project_root=REPO_ROOT)

    # 1A. Real subprocess acting as external FIGARO CLI binary reading JSON from stdin
    fake_figaro_script = (
        "import sys, json; "
        "req = json.load(sys.stdin); "
        "print('[figaro-runtime] solving request_id=' + req['request_id']); "
        "out = {"
        "'scenario': 'all_edge', "
        "'algorithm': 'FIGARO-CLI-MILP-v3', "
        "'estimated_cost_usd_hourly': 0.0, "
        "'allocations': [{"
        "'node_id': 'pve-edge-figaro', 'provider': 'proxmox', 'node_name': 'pve', "
        "'cores': 4, 'memory': 2048, 'disk_gb': 16, 'virtualization_type': 'lxc', "
        "'services': ['ingress', 'frontend', 'ai-proxy']}"
        "]}; "
        "print(json.dumps(out))"
    )
    cmd = f'"{sys.executable}" -c "{fake_figaro_script}"'
    directive = bridge.resolve_directive(
        prompt="Deploy Quota Pay via FIGARO CLI",
        cli_command=cmd,
        telemetry=_offline_telemetry(),
    )
    assert directive.source == "figaro-cli", f"Expected figaro-cli, got {directive.source}"
    assert directive.cli_execution.mode == "cli_subprocess"
    assert directive.cli_execution.exit_code == 0
    assert directive.enable_aws is False
    assert "pve-edge-figaro" in directive.placement_plan.nodes
    assert directive.requested_cpu_cores == 4
    assert directive.requested_memory_mb == 2048
    assert directive.requested_disk_gb == 16
    print("  ✅ Subprocess JSON-over-stdin/stdout with interleaved logs verified!")

    # 1B. Piped stdin placement payload
    piped = json.dumps(
        {
            "scenario": "all_edge",
            "nodes": {
                "edge-piped-01": {
                    "target_provider": "proxmox",
                    "target_node": "pve",
                    "cpu_cores": 2,
                    "memory_mb": 1024,
                    "disk_gb": 12,
                    "services": ["quota-ingress", "quota-web-frontend", "quota-ai-proxy"],
                }
            },
        }
    )
    stdin_dir = bridge.resolve_directive(
        prompt="Apply piped FIGARO directive",
        stdin_text=piped,
        telemetry=_offline_telemetry(),
    )
    assert stdin_dir.source == "figaro-stdin"
    assert "edge-piped-01" in stdin_dir.placement_plan.nodes
    assert stdin_dir.requested_disk_gb == 12
    print("  ✅ Piped stdin JSON directive parsing verified!")

    # 1C. Missing external binary falls back cleanly to Proxmox-first mock ($0.00/hr)
    fallback_dir = bridge.resolve_directive(
        prompt="Deploy Quota Pay on Proxmox with 3 cores and 2048MB RAM",
        cli_command="nonexistent_figaro_binary_xyz --solve",
        telemetry=_offline_telemetry(),
    )
    assert fallback_dir.source == "mock-proxmox-first"
    assert fallback_dir.cli_execution.exit_code == 127
    assert fallback_dir.enable_aws is False
    assert fallback_dir.requested_cpu_cores == 3
    assert fallback_dir.requested_memory_mb == 2048
    print("  ✅ Graceful fallback when external FIGARO binary is offline verified!")


def test_2_proxmox_first_end_to_end_pipeline() -> None:
    _banner("TEST 2: Proxmox-First 4-Agent LangGraph Pipeline Dry-Run & Audit Reports")
    with tempfile.TemporaryDirectory() as tmp_reports:
        cfg = AgentPipelineConfig(
            project_root=REPO_ROOT,
            report_dir=Path(tmp_reports),
            execution_mode="dry-run",
            enable_aws=False,
            nested_vtx_available=False,
        )
        supervisor = MultiAgentSupervisor(config=cfg, telemetry_override=_offline_telemetry())
        assert LANGGRAPH_AVAILABLE, "Expected langgraph to be active in this environment"
        assert supervisor.engine_name == "langgraph.StateGraph"

        state = supervisor.run(
            prompt="Deploy Quota Pay full stack on Proxmox node pve with 4 cores, 2048MB RAM, and 16GB disk"
        )

        assert state["status"] == "completed", f"Unexpected status: {state['status']}"
        assert state["guard_approved"] is True
        assert state["retry_count"] == 0
        assert state["deploy_succeeded"] is True
        assert state["audit_passed"] is True
        assert state["tfvars_data"]["enable_aws"] is False
        assert state["plan_diff"]["terraform_validate_passed"] is True
        assert len(state["plan_diff"]["aws_resources_planned"]) == 0
        assert len(state["plan_diff"]["proxmox_resources_planned"]) >= 3  # LXC + fw_options + fw_rules

        hcl_path = Path(state["authored_hcl_path"])
        assert hcl_path.exists()
        assert 'output "agent_deployment_manifest"' in hcl_path.read_text(encoding="utf-8")

        json_report = Path(state["report_json_path"])
        md_report = Path(state["report_md_path"])
        assert json_report.exists() and json_report.stat().st_size > 200
        assert md_report.exists() and md_report.stat().st_size > 200

        parsed_report = json.loads(json_report.read_text(encoding="utf-8"))
        assert parsed_report["enable_aws"] is False
        assert parsed_report["policy_audit"]["approved"] is True
        agents_seen = {entry["agent"] for entry in parsed_report["agent_logs"]}
        assert {
            "figaro_cli_bridge",
            "terraform_author_agent",
            "prompt_guard_agent",
            "deploy_runner_agent",
            "post_deploy_auditor_agent",
        }.issubset(agents_seen)

        print(f"  ✅ Full 4-agent LangGraph run passed ({len(parsed_report['agent_logs'])} trace steps)!")
        print(f"  ✅ Verified Proxmox resources={len(state['plan_diff']['proxmox_resources_planned'])}, AWS resources=0!")


def test_3_agent2_rejection_and_self_correction_loop() -> None:
    _banner("TEST 3: Agent 2 Policy Rejection -> Agent 1 Self-Correction Loop (max_retries=3)")

    # 3A. QEMU request on nested-VT-x-disabled Proxmox host -> Agent 2 rejects -> Agent 1 switches to LXC
    with tempfile.TemporaryDirectory() as tmp_reports:
        cfg = AgentPipelineConfig(
            project_root=REPO_ROOT,
            report_dir=Path(tmp_reports),
            execution_mode="dry-run",
            enable_aws=False,
            nested_vtx_available=False,
            max_retries=3,
        )
        supervisor = MultiAgentSupervisor(config=cfg, telemetry_override=_offline_telemetry())
        state = supervisor.run(
            prompt="Deploy Quota Pay as a QEMU full vm on Proxmox node pve with 2 cores and 1024MB RAM"
        )
        assert state["guard_approved"] is True
        assert state["retry_count"] == 1, f"Expected 1 retry for QEMU->LXC fallback, got {state['retry_count']}"
        first_attempt = state["policy_history"][0]
        assert first_attempt["approved"] is False
        assert any(v["code"] == "PROXMOX_NESTED_VTX_UNSAFE" for v in first_attempt["violations"])
        first_node = next(iter(state["tfvars_data"]["placement_plan"].values()))
        assert first_node["virtualization_type"] == "lxc"
        print("  ✅ Case 3A: Nested VT-x unsafe QEMU rejected by Agent 2 -> auto-corrected to LXC by Agent 1!")

    # 3B. External FIGARO CLI sneaks AWS node while enable_aws=False -> Agent 2 blocks -> Agent 1 strips AWS
    unauthorized_aws_payload = json.dumps(
        {
            "scenario": "hybrid",
            "allocations": [
                {
                    "node_id": "edge-01",
                    "provider": "proxmox",
                    "node_name": "pve",
                    "cores": 2,
                    "memory": 1024,
                    "virtualization_type": "lxc",
                    "services": ["ingress", "frontend"],
                },
                {
                    "node_id": "rogue-aws-01",
                    "provider": "aws",
                    "node_name": "eu-south-1a",
                    "cores": 2,
                    "memory": 1024,
                    "services": ["ai-proxy"],
                },
            ],
        }
    )
    with tempfile.TemporaryDirectory() as tmp_reports:
        cfg = AgentPipelineConfig(
            project_root=REPO_ROOT,
            report_dir=Path(tmp_reports),
            execution_mode="dry-run",
            enable_aws=False,
            nested_vtx_available=False,
            max_retries=3,
        )
        supervisor = MultiAgentSupervisor(config=cfg, telemetry_override=_offline_telemetry())
        state = supervisor.run(
            prompt="Deploy Quota Pay locally on Proxmox only ($0 cost)",
            figaro_stdin=unauthorized_aws_payload,
        )
        assert state["guard_approved"] is True
        assert state["retry_count"] >= 1
        assert any(
            v["code"] == "AWS_NOT_AUTHORIZED"
            for v in state["policy_history"][0]["violations"]
        )
        assert state["tfvars_data"]["enable_aws"] is False
        assert all(
            n["target_provider"] == "proxmox"
            for n in state["tfvars_data"]["placement_plan"].values()
        )
        print("  ✅ Case 3B: Unauthorized AWS placement blocked by Agent 2 -> re-authored to Proxmox-only!")

    # 3C. Static rubric checks hardcoded secrets, exposed management ports, and 0.0.0.0/0 SSH
    cfg = AgentPipelineConfig(project_root=REPO_ROOT, enable_aws=False, nested_vtx_available=False)
    synthetic_secret = "AIza" + "SyDummyTestKeyForRubricValidation12345"
    bad_tfvars = {
        "enable_aws": False,
        "proxmox_ssh_allowed_cidr": "0.0.0.0/0",
        "proxmox_disable_password_auth": False,
        "gemini_api_key": synthetic_secret,
        "placement_plan": {
            "edge-primary": {
                "target_provider": "proxmox",
                "target_node": "pve",
                "cpu_cores": 2,
                "memory_mb": 1024,
                "disk_gb": 8,
                "virtualization_type": "lxc",
                "enable_firewall": False,
                "allowed_ports": [80, 2375, 8006],
                "services": ["quota-ingress", "quota-web-frontend", "quota-ai-proxy"],
            }
        },
    }
    bad_directive = {
        "enable_aws": False,
        "target_proxmox_node": "pve",
        "requested_node_count": 1,
        "requested_cpu_cores": 2,
        "requested_memory_mb": 1024,
        "requested_disk_gb": 8,
        "requested_services": ["quota-ingress", "quota-web-frontend", "quota-ai-proxy"],
        "require_firewall": True,
        "disable_password_auth": True,
    }
    violations = evaluate_pre_deploy_rubric(bad_directive, bad_tfvars, {}, None, cfg)
    codes = {v.code for v in violations}
    for expected_code in (
        "HARDCODED_SECRET",
        "FIREWALL_DISABLED",
        "EXPOSED_MANAGEMENT_PORT",
        "OPEN_SSH_CIDR",
        "SSH_PASSWORD_AUTH_ENABLED",
    ):
        assert expected_code in codes, f"Missing expected violation {expected_code}; got {codes}"
    print(f"  ✅ Case 3C: Rubric detected all security violations: {sorted(codes)}")


def test_4_agent4_post_deploy_security_and_perf_remediation() -> None:
    _banner("TEST 4: Agent 4 Post-Deploy Security & Performance Auto-Remediation Loop")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_root = Path(tmp_dir)
        tmp_docker = tmp_root / "docker"
        tmp_reports = tmp_root / "reports"
        tmp_docker.mkdir(parents=True)
        # Deliberately unhardened/unoptimized Caddyfile copy (no compression, no cache, no security headers)
        (tmp_docker / "Caddyfile.ingress").write_text(
            "{$DOMAIN_NAME::80} {\n"
            "  respond /healthz 200 {\n"
            '    body "ok"\n'
            "  }\n"
            "  handle {\n"
            "    reverse_proxy quota-web-frontend:8080\n"
            "  }\n"
            "}\n",
            encoding="utf-8",
        )

        cfg = AgentPipelineConfig(
            project_root=REPO_ROOT,
            docker_dir=tmp_docker,
            report_dir=tmp_reports,
            execution_mode="dry-run",
            enable_aws=False,
            auto_remediate=True,
        )
        supervisor = MultiAgentSupervisor(config=cfg, telemetry_override=_offline_telemetry())

        degraded_telemetry = {
            "open_ports": [80, 443, 2375, 8006],
            "firewall_enabled": False,
            "ssh_password_auth_enabled": True,
            "ssh_allowed_cidr": "0.0.0.0/0",
            "allowed_cidrs": ["0.0.0.0/0"],
            "http_latency_ms": 420.0,
            "memory_utilization_pct": 91.5,
            "cpu_utilization_pct": 89.0,
        }
        state = supervisor.run(
            prompt="Deploy Quota Pay on Proxmox node pve with 2 cores and 1024MB RAM",
            initial_runtime_telemetry=degraded_telemetry,
        )

        initial_ids = {f["finding_id"] for f in state["audit_findings"]}
        remediated_ids = {r["finding_id"] for r in state["remediations_applied"] if r["applied"] and r["re_verified"]}

        for must_catch in (
            "SEC-EXPOSED-MGMT-PORT",
            "SEC-FIREWALL-DISABLED",
            "SEC-SSH-PASSWORD-AUTH",
            "SEC-PERMISSIVE-SSH-CIDR",
            "SEC-MISSING-HTTP-HEADERS",
            "PERF-HIGH-LATENCY",
            "PERF-MEMORY-PRESSURE",
            "PERF-CPU-PRESSURE",
            "PERF-MISSING-COMPRESSION",
            "PERF-MISSING-STATIC-CACHE",
        ):
            assert must_catch in initial_ids, f"Agent 4 missed expected finding {must_catch}; got {initial_ids}"
            assert must_catch in remediated_ids, f"Agent 4 did not auto-remediate {must_catch}; got {remediated_ids}"

        assert state["audit_passed"] is True, f"Expected audit_passed=True after remediation; remaining={state['post_remediation_findings']}"
        patched_caddy = (tmp_docker / "Caddyfile.ingress").read_text(encoding="utf-8")
        assert "encode zstd gzip" in patched_caddy
        assert "Cache-Control" in patched_caddy
        assert "X-Content-Type-Options" in patched_caddy

        # Verify RAM and CPU were bumped in tfvars for performance tuning
        tuned_node = next(iter(state["tfvars_data"]["placement_plan"].values()))
        assert tuned_node["memory_mb"] > 1024
        assert tuned_node["cpu_cores"] > 2
        assert 2375 not in tuned_node["allowed_ports"]
        assert 8006 not in tuned_node["allowed_ports"]

        print(f"  ✅ Agent 4 detected {len(initial_ids)} findings and auto-remediated {len(remediated_ids)} cleanly!")
        print(f"  ✅ Verified patched Caddyfile compression/cache/headers + tuned node ({tuned_node['cpu_cores']} vCPU, {tuned_node['memory_mb']}MB)!")


def test_5_optional_aws_opt_in_preserved() -> None:
    _banner("TEST 5: Optional AWS Secondary Target Preserved Behind enable_aws=True")
    with tempfile.TemporaryDirectory() as tmp_reports:
        cfg = AgentPipelineConfig(
            project_root=REPO_ROOT,
            report_dir=Path(tmp_reports),
            execution_mode="dry-run",
            enable_aws=True,
        )
        supervisor = MultiAgentSupervisor(config=cfg, telemetry_override=_offline_telemetry())
        state = supervisor.run(
            prompt="Deploy hybrid split with Proxmox edge UI and AWS Spot AI proxy"
        )
        assert state["guard_approved"] is True
        assert state["tfvars_data"]["enable_aws"] is True
        assert len(state["plan_diff"]["aws_resources_planned"]) > 0
        assert len(state["plan_diff"]["proxmox_resources_planned"]) > 0
        print(
            f"  ✅ Opt-in hybrid AWS verified: proxmox={len(state['plan_diff']['proxmox_resources_planned'])}, "
            f"aws={len(state['plan_diff']['aws_resources_planned'])}!"
        )


def test_6_realtime_telemetry_jsonl_and_sse() -> None:
    _banner("TEST 6: Real-Time Observability Bus, JSONL Timeline, SSE UI & Non-TTY JSON")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_reports = Path(tmp_dir)
        captured_events: list[AgentEvent] = []

        # 6A. Event callback & JSONL timeline during retry loop (QEMU -> LXC)
        bus = AgentEventBus()
        ui_obs = LiveSSEServerObserver(port=0, prompt="QEMU retry telemetry check")
        ui_url = ui_obs.start()
        try:
            bus.subscribe(captured_events.append)
            bus.subscribe(ui_obs.on_state_change)

            cfg = AgentPipelineConfig(
                project_root=REPO_ROOT,
                report_dir=tmp_reports,
                execution_mode="dry-run",
                enable_aws=False,
                nested_vtx_available=False,
                max_retries=3,
            )
            supervisor = MultiAgentSupervisor(
                config=cfg,
                telemetry_override=_offline_telemetry(),
                event_bus=bus,
            )
            state = supervisor.run(
                prompt="Deploy Quota Pay as a QEMU full vm on Proxmox node pve with 2 cores and 1024MB RAM"
            )
            assert state["status"] == "completed"

            agents_seen = {e.agent_id for e in captured_events}
            for req_agent in (
                "pipeline",
                "figaro_cli_bridge",
                "terraform_author_agent",
                "prompt_guard_agent",
                "deploy_runner_agent",
                "post_deploy_auditor_agent",
                "report_writer",
            ):
                assert req_agent in agents_seen, f"Missing events from {req_agent}; got {agents_seen}"
            assert any(e.status == "RETRYING" for e in captured_events), "Expected RETRYING event on QEMU->LXC fallback"

            timeline_path = Path(state["state_timeline_path"])
            report_md_path = Path(state["report_md_path"])
            assert timeline_path.exists()
            assert timeline_path.stem.replace("state_timeline_", "") == report_md_path.stem.replace("deployment_audit_", "")

            jsonl_lines = [ln for ln in timeline_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
            assert len(jsonl_lines) >= 10
            parsed_events = [AgentEvent.model_validate_json(ln) for ln in jsonl_lines]
            assert parsed_events[-1].agent_id in ("pipeline", "report_writer")
            assert bus.overhead_ms < 50.0, f"Expected near-zero dispatch overhead, got {bus.overhead_ms:.2f}ms"

            # 6B. Verify SSE server HTTP endpoints (HTML, /api/state JSON, and live /events stream)
            with urllib.request.urlopen(f"{ui_url}/", timeout=3.0) as html_resp:
                assert html_resp.status == 200
                html_text = html_resp.read().decode("utf-8")
                assert "EventSource('/events?offset='" in html_text

            with urllib.request.urlopen(f"{ui_url}/api/state", timeout=3.0) as api_resp:
                assert api_resp.status == 200
                api_json = json.loads(api_resp.read().decode("utf-8"))
                assert api_json["snapshot"]["status"] == "PASSED"
                assert len(api_json["events"]) == len(captured_events)

            with urllib.request.urlopen(f"{ui_url}/events?offset=0", timeout=3.0) as sse_resp:
                assert sse_resp.status == 200
                first_chunk = sse_resp.readline().decode("utf-8")
                assert first_chunk.startswith("data: "), f"Unexpected SSE frame: {first_chunk!r}"
        finally:
            ui_obs.stop()

        print(f"  ✅ Callback & JSONL timeline verified ({len(captured_events)} events, overhead={bus.overhead_ms:.3f}ms)!")
        print("  ✅ Live SSE dashboard HTML, /api/state, /events replay & clean shutdown verified!")

        # 6C. Verify CLI --dry-run --json emits strictly parseable stdout JSON
        cli_json_proc = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "run_agent_pipeline.py"),
                "--dry-run",
                "--json",
                "--report-dir",
                str(tmp_reports / "cli_json"),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert cli_json_proc.returncode == 0, f"--dry-run --json failed: {cli_json_proc.stderr}"
        cli_summary = json.loads(cli_json_proc.stdout)
        assert cli_summary["status"] == "completed"
        assert Path(cli_summary["state_timeline_path"]).exists()
        print("  ✅ CLI `--dry-run --json` emits pure JSON stdout cleanly!")

        # 6D. Verify CLI --dry-run --ui --ui-port 0 starts and terminates cleanly
        cli_ui_proc = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "run_agent_pipeline.py"),
                "--dry-run",
                "--ui",
                "--ui-port",
                "0",
                "--report-dir",
                str(tmp_reports / "cli_ui"),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert cli_ui_proc.returncode == 0, f"--dry-run --ui failed: {cli_ui_proc.stderr}"
        assert "Live Agent Dashboard: http://127.0.0.1:" in cli_ui_proc.stdout
        print("  ✅ CLI `--dry-run --ui` started SSE server and exited cleanly!")


def main() -> None:
    print("=" * 74)
    print("🚀 RUNNING PROXMOX-FIRST 4-AGENT PIPELINE & FIGARO CLI TEST SUITE")
    print("=" * 74)
    try:
        test_1_figaro_cli_bridge()
        test_2_proxmox_first_end_to_end_pipeline()
        test_3_agent2_rejection_and_self_correction_loop()
        test_4_agent4_post_deploy_security_and_perf_remediation()
        test_5_optional_aws_opt_in_preserved()
        test_6_realtime_telemetry_jsonl_and_sse()
        print("\n" + "=" * 74)
        print("🎉 ALL 4-AGENT PIPELINE & FIGARO CLI BRIDGE TESTS PASSED!")
        print("=" * 74)
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

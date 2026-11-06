#!/usr/bin/env python3
"""
Quota Pay — Autonomous Terraform Actuator (infra/scripts/terraform_actuator.py)
Manages the lifecycle of the ephemeral eu-south-1 AWS Spot EC2 infrastructure.
Exposes `deploy_spot_instance()` and `emergency_destroy(reason)` executing
`terraform apply -auto-approve` and `terraform destroy -auto-approve` inside
isolated subprocesses.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

TERRAFORM_DIR = Path(__file__).resolve().parent.parent / "terraform"


def _build_tf_env(extra_env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Constructs environment variables and TF_VAR_* mappings for subprocess execution."""
    env = os.environ.copy()
    env.setdefault("AWS_PROFILE", "efekankati")
    env.setdefault("AWS_DEFAULT_REGION", "eu-south-1")
    env.setdefault("AWS_REGION", "eu-south-1")

    # Strip any placeholder or empty static key variables so AWS_PROFILE=`efekankati` is always used
    for key_var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        val = env.get(key_var, "")
        if not val or "your_aws_" in val:
            env.pop(key_var, None)

    # Map standard .env variables to Terraform TF_VAR_* inputs automatically
    mappings = {
        "AWS_PROFILE": "TF_VAR_aws_profile",
        "GEMINI_API_KEY": "TF_VAR_gemini_api_key",
        "EXPO_PUBLIC_GEMINI_API_KEY": "TF_VAR_gemini_api_key",
        "SUPABASE_URL": "TF_VAR_supabase_url",
        "EXPO_PUBLIC_SUPABASE_URL": "TF_VAR_supabase_url",
        "SUPABASE_ANON_KEY": "TF_VAR_supabase_anon_key",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "TF_VAR_supabase_anon_key",
        "AI_MAX_BUDGET_USD": "TF_VAR_ai_max_budget_usd",
        "DOMAIN_NAME": "TF_VAR_domain_name",
    }

    for src_key, tf_var in mappings.items():
        val = env.get(src_key)
        if val and tf_var not in env:
            env[tf_var] = val

    if extra_env:
        env.update(extra_env)

    return env


def _run_terraform_cmd(
    args: list[str],
    dry_run: bool = False,
    timeout_sec: int = 900,
) -> subprocess.CompletedProcess:
    """Executes a Terraform CLI command inside an isolated subprocess."""
    cmd = ["terraform"] + args
    if dry_run:
        print(f"[TerraformActuator][DRY-RUN] Would execute: {' '.join(cmd)} in {TERRAFORM_DIR}")
        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

    return subprocess.run(
        cmd,
        cwd=str(TERRAFORM_DIR),
        env=_build_tf_env(),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )


def deploy_spot_instance(dry_run: bool = False) -> Dict[str, Any]:
    """
    Initializes and provisions the minimal-cost eu-south-1 EC2 Spot instance
    via `terraform init` and `terraform apply -auto-approve`.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"[{timestamp}] [TerraformActuator] Starting Spot EC2 deployment in eu-south-1...")

    init_proc = _run_terraform_cmd(["init", "-input=false"], dry_run=dry_run)
    if init_proc.returncode != 0:
        raise RuntimeError(
            f"terraform init failed (exit {init_proc.returncode}): {init_proc.stderr.strip()}"
        )

    apply_proc = _run_terraform_cmd(
        ["apply", "-auto-approve", "-input=false"],
        dry_run=dry_run,
    )
    if apply_proc.returncode != 0:
        raise RuntimeError(
            f"terraform apply failed (exit {apply_proc.returncode}): {apply_proc.stderr.strip()}"
        )

    outputs: Dict[str, Any] = {}
    out_proc = _run_terraform_cmd(["output", "-json"], dry_run=dry_run)
    if out_proc.returncode == 0 and out_proc.stdout.strip():
        try:
            raw_outputs = json.loads(out_proc.stdout)
            outputs = {
                k: v.get("value") if isinstance(v, dict) else v
                for k, v in raw_outputs.items()
            }
        except json.JSONDecodeError:
            outputs = {}

    public_ip = outputs.get("server_public_ip")
    if public_ip and not dry_run:
        root_env_path = TERRAFORM_DIR.parent.parent / ".env"
        if root_env_path.exists():
            try:
                env_lines = root_env_path.read_text(encoding="utf-8").splitlines()
                updated_lines = []
                found = False
                for line in env_lines:
                    if line.strip().startswith("EXPO_PUBLIC_AI_PROXY_URL="):
                        updated_lines.append(f"EXPO_PUBLIC_AI_PROXY_URL=http://{public_ip}")
                        found = True
                    else:
                        updated_lines.append(line)
                if not found:
                    updated_lines.append(f"EXPO_PUBLIC_AI_PROXY_URL=http://{public_ip}")
                root_env_path.write_text("\n".join(updated_lines) + "\n", encoding="utf-8")
            except Exception as exc:
                print(f"[TerraformActuator] Warning updating .env: {exc}")

    result = {
        "status": "deployed",
        "region": "eu-south-1",
        "timestamp": timestamp,
        "server_public_ip": public_ip,
        "guest_share_origin": f"http://{public_ip}.sslip.io" if public_ip else None,
        "instance_id": outputs.get("instance_id"),
    }
    print(f"[TerraformActuator] Deployment complete: {json.dumps(result)}")
    return result


def emergency_destroy(reason: str, dry_run: bool = False) -> Dict[str, Any]:
    """
    Immediately tears down all billable AWS infrastructure in eu-south-1
    via `terraform destroy -auto-approve` inside an isolated subprocess,
    reducing cloud compute spend to $0.00/hr.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    print(
        f"[{timestamp}] [TerraformActuator] EMERGENCY DESTROY TRIGGERED! Reason: {reason}",
        file=sys.stderr,
    )

    destroy_proc = _run_terraform_cmd(
        ["destroy", "-auto-approve", "-input=false"],
        dry_run=dry_run,
    )

    if destroy_proc.returncode != 0:
        raise RuntimeError(
            f"terraform destroy failed (exit {destroy_proc.returncode}): {destroy_proc.stderr.strip()}"
        )

    result = {
        "status": "destroyed",
        "reason": reason,
        "region": "eu-south-1",
        "hourly_cost_usd": 0.0,
        "timestamp": timestamp,
    }
    print(f"[TerraformActuator] All AWS resources destroyed ($0.00/hr): {json.dumps(result)}")
    return result


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    is_dry = "--dry-run" in sys.argv

    if action == "up" or action == "deploy":
        deploy_spot_instance(dry_run=is_dry)
    elif action == "destroy":
        reason_arg = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else "Manual operator teardown"
        emergency_destroy(reason_arg, dry_run=is_dry)
    else:
        print("Usage: python terraform_actuator.py [deploy|destroy] [reason] [--dry-run]")

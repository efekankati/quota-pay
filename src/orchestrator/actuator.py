"""
Terraform Actuator & Deployment Engine.
Serializes PlacementPlan into Terraform tfvars, writes dynamic docker environment files,
and programmatically executes terraform commands.
"""

from __future__ import annotations
import os
import json
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
from .schema import PlacementPlan


class TerraformActuator:
    """
    Executes infrastructure placement decisions by translating PlacementPlan
    models into Terraform tfvars and running the Terraform lifecycle.
    """

    def __init__(self, project_root: Optional[Path] = None):
        if project_root is None:
            # Default to repo root (2 levels up from src/orchestrator/)
            self.project_root = Path(__file__).resolve().parent.parent.parent
        else:
            self.project_root = Path(project_root).resolve()

        self.infra_dir = self.project_root / "infra"
        self.docker_dir = self.project_root / "docker"

    def export_tfvars_json(
        self,
        plan: PlacementPlan,
        output_path: Optional[Path] = None
    ) -> Path:
        """
        Serializes the PlacementPlan into infra/terraform.tfvars.json for Terraform consumption.
        """
        target = output_path or (self.infra_dir / "terraform.tfvars.json")
        target.parent.mkdir(parents=True, exist_ok=True)

        tfvars_data = plan.to_terraform_vars()

        with open(target, "w", encoding="utf-8") as f:
            json.dump(tfvars_data, f, indent=2)

        return target

    def generate_placement_env(
        self,
        plan: PlacementPlan,
        edge_ip: str = "127.0.0.1",
        cloud_ip: str = "15.161.41.185",
        output_path: Optional[Path] = None,
        gemini_api_key: str = "",
        supabase_url: str = "https://nnamvsnorjbsruwhkker.supabase.co",
        supabase_anon_key: str = "",
    ) -> Path:
        """
        Writes docker/.env.placement dynamically based on the active placement scenario.
        """
        target = output_path or (self.docker_dir / ".env.placement")
        target.parent.mkdir(parents=True, exist_ok=True)

        scenario = plan.scenario.lower()

        # Route upstreams according to placement scenario
        if scenario == "all_edge":
            ai_proxy_upstream = "quota-ai-proxy:3000"
            frontend_upstream = "quota-web-frontend:8080"
        elif scenario == "hybrid":
            # Edge ingress forwards /api/* to AWS Cloud Spot instance
            ai_proxy_upstream = f"{cloud_ip}:3000"
            frontend_upstream = "quota-web-frontend:8080"
        elif scenario == "cloud_burst":
            # Everything in cloud: ingress talks to local cloud containers
            ai_proxy_upstream = "quota-ai-proxy:3000"
            frontend_upstream = "quota-web-frontend:8080"
        else:
            ai_proxy_upstream = f"{cloud_ip}:3000"
            frontend_upstream = f"{edge_ip}:8080"

        env_content = f"""# =============================================================================
# Quota Pay — Placement Runtime Environment (Generated for scenario: {plan.scenario})
# =============================================================================
PLACEMENT_SCENARIO={plan.scenario}
AI_PROXY_UPSTREAM={ai_proxy_upstream}
FRONTEND_UPSTREAM={frontend_upstream}
DOMAIN_NAME=:80
GEMINI_API_KEY={gemini_api_key}
SUPABASE_URL={supabase_url}
SUPABASE_ANON_KEY={supabase_anon_key}
AI_MAX_BUDGET_USD=5.00
SPOT_HOURLY_RATE_USD=0.005
AWS_REGION=eu-south-1
"""
        with open(target, "w", encoding="utf-8") as f:
            f.write(env_content)

        return target

    def _run_tf_command(self, args: list[str], timeout_sec: int = 120) -> Dict[str, Any]:
        """Runs a Terraform CLI command inside the infra directory."""
        cmd = ["terraform", f"-chdir={self.infra_dir}"] + args
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                check=False,
            )
            return {
                "success": res.returncode == 0,
                "returncode": res.returncode,
                "stdout": res.stdout.strip(),
                "stderr": res.stderr.strip(),
                "command": " ".join(cmd),
            }
        except subprocess.TimeoutExpired as e:
            return {
                "success": False,
                "returncode": -1,
                "stdout": "",
                "stderr": f"Terraform command timed out after {timeout_sec}s",
                "command": " ".join(cmd),
            }
        except Exception as e:
            return {
                "success": False,
                "returncode": -1,
                "stdout": "",
                "stderr": str(e),
                "command": " ".join(cmd),
            }

    def init(self) -> Dict[str, Any]:
        """Runs terraform init."""
        return self._run_tf_command(["init"])

    def validate(self) -> Dict[str, Any]:
        """Runs terraform validate."""
        return self._run_tf_command(["validate"])

    def plan(self, var_file: Optional[str] = "terraform.tfvars.json") -> Dict[str, Any]:
        """Runs terraform plan."""
        args = ["plan"]
        if var_file:
            args.append(f"-var-file={var_file}")
        return self._run_tf_command(args, timeout_sec=60)

    def apply(self, var_file: Optional[str] = "terraform.tfvars.json", auto_approve: bool = True) -> Dict[str, Any]:
        """Runs terraform apply."""
        args = ["apply"]
        if auto_approve:
            args.append("-auto-approve")
        if var_file:
            args.append(f"-var-file={var_file}")
        return self._run_tf_command(args, timeout_sec=300)

    def destroy(self, var_file: Optional[str] = "terraform.tfvars.json", auto_approve: bool = True) -> Dict[str, Any]:
        """Runs terraform destroy."""
        args = ["destroy"]
        if auto_approve:
            args.append("-auto-approve")
        if var_file:
            args.append(f"-var-file={var_file}")
        return self._run_tf_command(args, timeout_sec=300)

    def get_topology(self) -> Dict[str, Any]:
        """Retrieves active Terraform outputs in structured JSON format."""
        res = self._run_tf_command(["output", "-json"])
        if res["success"]:
            try:
                data = json.loads(res["stdout"])
                return {
                    k: v.get("value", v) if isinstance(v, dict) else v
                    for k, v in data.items()
                }
            except json.JSONDecodeError:
                return {}
        return {}

"""
Terraform Actuator & Deployment Engine.
Serializes PlacementPlan into Terraform tfvars, writes dynamic docker environment files,
and programmatically executes terraform commands.
"""

from __future__ import annotations
import os
import json
import socket
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
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

    def load_root_dotenv(self) -> Dict[str, str]:
        """Reads project root .env into a dict and populates missing os.environ entries."""
        env_map: Dict[str, str] = {}
        root_env = self.project_root / ".env"
        if not root_env.exists():
            return env_map
        try:
            for raw_line in root_env.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k:
                    env_map[k] = v
                    if not os.environ.get(k):
                        os.environ[k] = v
        except Exception:
            pass
        return env_map

    def _build_tf_env(self) -> Dict[str, str]:
        """Builds Terraform subprocess env with root .env mapped to TF_VAR_* inputs."""
        dotenv = self.load_root_dotenv()
        env = os.environ.copy()
        env.setdefault("AWS_PROFILE", dotenv.get("AWS_PROFILE", "efekankati"))
        env.setdefault("AWS_DEFAULT_REGION", dotenv.get("AWS_DEFAULT_REGION", "eu-south-1"))
        env.setdefault("AWS_REGION", dotenv.get("AWS_REGION", "eu-south-1"))

        for key_var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            val = env.get(key_var, "")
            if not val or "your_aws_" in val:
                env.pop(key_var, None)

        mappings = {
            "AWS_PROFILE": "TF_VAR_aws_profile",
            "GEMINI_API_KEY": "TF_VAR_gemini_api_key",
            "EXPO_PUBLIC_GEMINI_API_KEY": "TF_VAR_gemini_api_key",
            "SUPABASE_URL": "TF_VAR_supabase_url",
            "EXPO_PUBLIC_SUPABASE_URL": "TF_VAR_supabase_url",
            "SUPABASE_ANON_KEY": "TF_VAR_supabase_anon_key",
            "EXPO_PUBLIC_SUPABASE_ANON_KEY": "TF_VAR_supabase_anon_key",
            "AI_MAX_BUDGET_USD": "TF_VAR_ai_max_budget_usd",
        }
        for src_key, tf_var in mappings.items():
            val = env.get(src_key) or dotenv.get(src_key)
            if val and not env.get(tf_var):
                env[tf_var] = val

        if not env.get("TF_VAR_git_branch"):
            branch = "main"
            try:
                br = subprocess.run(
                    ["git", "-C", str(self.project_root), "rev-parse", "--abbrev-ref", "HEAD"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                    check=False,
                )
                cand = br.stdout.strip()
                if br.returncode == 0 and cand and cand != "HEAD":
                    # Only pass feature branch if it already exists on origin
                    rem = subprocess.run(
                        ["git", "-C", str(self.project_root), "ls-remote", "--heads", "origin", cand],
                        capture_output=True,
                        text=True,
                        timeout=4,
                        check=False,
                    )
                    if rem.returncode == 0 and cand in rem.stdout:
                        branch = cand
            except Exception:
                pass
            env["TF_VAR_git_branch"] = branch

        return env

    def export_tfvars_json(
        self,
        plan: PlacementPlan,
        output_path: Optional[Path] = None,
        exclude_proxmox: bool = False,
        enable_aws: Optional[bool] = None,
        extra_vars: Optional[Dict[str, Any]] = None,
    ) -> Path:
        """
        Serializes the PlacementPlan into infra/terraform.tfvars.json for Terraform consumption.
        When exclude_proxmox=True (reusing existing Container 101), filters out Proxmox nodes.
        """
        target = output_path or (self.infra_dir / "terraform.tfvars.json")
        target.parent.mkdir(parents=True, exist_ok=True)

        tfvars_data = plan.to_terraform_vars(enable_aws=enable_aws)
        if exclude_proxmox and isinstance(tfvars_data.get("placement_plan"), dict):
            tfvars_data["placement_plan"] = {
                k: v
                for k, v in tfvars_data["placement_plan"].items()
                if v.get("target_provider") != "proxmox"
            }
        if extra_vars:
            tfvars_data.update(extra_vars)

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
                env=self._build_tf_env(),
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

    def plan(self, var_file: Optional[str] = "terraform.tfvars.json", out_file: Optional[str] = None) -> Dict[str, Any]:
        """Runs terraform plan (optionally writing a binary plan file)."""
        args = ["plan", "-input=false"]
        if var_file:
            args.append(f"-var-file={var_file}")
        if out_file:
            args.append(f"-out={out_file}")
        return self._run_tf_command(args, timeout_sec=60)

    def plan_json(self, var_file: Optional[str] = "terraform.tfvars.json") -> Dict[str, Any]:
        """
        Runs `terraform plan -out=tfplan.binary` followed by `terraform show -json tfplan.binary`
        so pre-execution auditors can inspect exact planned resource changes in JSON.
        """
        plan_bin = self.infra_dir / "tfplan.binary"
        plan_res = self.plan(var_file=var_file, out_file=plan_bin.name)
        if not plan_res["success"]:
            plan_bin.unlink(missing_ok=True)
            return {
                **plan_res,
                "plan_json": None,
            }

        show_res = self._run_tf_command(["show", "-json", plan_bin.name], timeout_sec=30)
        plan_bin.unlink(missing_ok=True)
        parsed: Optional[Dict[str, Any]] = None
        if show_res["success"] and show_res["stdout"]:
            try:
                parsed = json.loads(show_res["stdout"])
            except json.JSONDecodeError:
                parsed = None
        return {
            "success": show_res["success"] and parsed is not None,
            "returncode": show_res["returncode"],
            "stdout": plan_res["stdout"],
            "stderr": show_res["stderr"] or plan_res["stderr"],
            "command": f"{plan_res['command']} && {show_res['command']}",
            "plan_json": parsed,
        }

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

    @staticmethod
    def _extract_first_ipv4(raw_val: Any) -> Optional[str]:
        """Recursively extracts the first non-loopback IPv4 string from nested TF outputs."""
        if isinstance(raw_val, str):
            candidate = raw_val.split("/")[0].strip()
            parts = candidate.split(".")
            if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                if not candidate.startswith("127."):
                    return candidate
            return None
        if isinstance(raw_val, (list, tuple)):
            for item in raw_val:
                found = TerraformActuator._extract_first_ipv4(item)
                if found:
                    return found
        return None

    def resolve_live_ips_from_topology(
        self,
        default_edge_ip: str = "192.168.178.128",
        default_cloud_ip: str = "15.160.125.0",
    ) -> Dict[str, str]:
        """
        Reads post-apply Terraform outputs (`cloud_nodes`, `edge_nodes`) to resolve
        real dynamically allocated IP addresses instead of hardcoded defaults.
        """
        resolved_edge = default_edge_ip
        resolved_cloud = default_cloud_ip

        topology = self.get_topology()
        cloud_nodes = topology.get("cloud_nodes")
        if isinstance(cloud_nodes, dict):
            for node_info in cloud_nodes.values():
                if isinstance(node_info, dict):
                    pub_ip = str(node_info.get("public_ip") or "").strip()
                    if pub_ip:
                        resolved_cloud = pub_ip
                        break

        edge_nodes = topology.get("edge_nodes")
        if isinstance(edge_nodes, dict):
            for node_info in edge_nodes.values():
                if isinstance(node_info, dict):
                    candidate = self._extract_first_ipv4(node_info.get("ipv4_addresses"))
                    if candidate:
                        resolved_edge = candidate
                        break

        return {"edge_ip": resolved_edge, "cloud_ip": resolved_cloud}

    def update_root_env_ai_proxy(self, ai_proxy_url: str) -> None:
        """Updates EXPO_PUBLIC_AI_PROXY_URL inside root .env when a live IP changes."""
        root_env = self.project_root / ".env"
        if not root_env.exists():
            return
        try:
            lines = root_env.read_text(encoding="utf-8").splitlines()
            updated = []
            found = False
            for line in lines:
                if line.strip().startswith("EXPO_PUBLIC_AI_PROXY_URL="):
                    updated.append(f"EXPO_PUBLIC_AI_PROXY_URL={ai_proxy_url}")
                    found = True
                else:
                    updated.append(line)
            if not found:
                updated.append(f"EXPO_PUBLIC_AI_PROXY_URL={ai_proxy_url}")
            root_env.write_text("\n".join(updated) + "\n", encoding="utf-8")
        except Exception:
            pass

    def publish_endpoints_to_supabase(
        self,
        scenario: str,
        edge_ip: str,
        cloud_ip: str,
    ) -> bool:
        """
        Publishes active Cloud & Edge endpoints to Supabase `orchestrator_endpoints`
        so mobile clients discover newly provisioned AWS Spot IPs dynamically.
        """
        dotenv: Dict[str, str] = {}
        root_env = self.project_root / ".env"
        if root_env.exists():
            try:
                for raw in root_env.read_text(encoding="utf-8").splitlines():
                    line = raw.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        dotenv[k.strip()] = v.strip().strip('"').strip("'")
            except Exception:
                pass

        supabase_url = (
            os.environ.get("SUPABASE_URL")
            or os.environ.get("EXPO_PUBLIC_SUPABASE_URL")
            or dotenv.get("SUPABASE_URL")
            or dotenv.get("EXPO_PUBLIC_SUPABASE_URL")
            or ""
        ).strip()
        supabase_key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_ANON_KEY")
            or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
            or dotenv.get("SUPABASE_SERVICE_ROLE_KEY")
            or dotenv.get("SUPABASE_ANON_KEY")
            or dotenv.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
            or ""
        ).strip()

        if not supabase_url or not supabase_key:
            return False

        endpoint = f"{supabase_url.rstrip('/')}/rest/v1/orchestrator_endpoints"
        payload = json.dumps({
            "id": "active",
            "scenario": scenario,
            "edge_url": f"http://{edge_ip}" if edge_ip else "",
            "cloud_url": f"http://{cloud_ip}:3000" if cloud_ip else "",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).encode("utf-8")

        req = urllib.request.Request(
            endpoint,
            data=payload,
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                return 200 <= resp.status < 300
        except (urllib.error.URLError, TimeoutError, Exception):
            return False

    def sync_edge_upstreams(
        self,
        pve_host: str = "192.168.178.125",
        container_id: int = 101,
        scenario: str = "hybrid",
    ) -> bool:
        """
        Synchronizes existing Proxmox LXC container (`container_id`) for the requested scenario:
          - `cloud_burst`: stops container so Proxmox UI reflects edge offline
          - `hybrid`: ensures container is started, stops local edge ai-proxy, configures Caddy -> AWS IP
          - `all_edge`: ensures container is started with all 3 services (ingress, frontend, ai-proxy)
        """
        try:
            with socket.create_connection((pve_host, 22), timeout=1.5):
                pass
        except OSError:
            return False

        ssh_base = [
            "ssh",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "ConnectTimeout=3",
            f"root@{pve_host}",
        ]

        scenario_key = scenario.strip().lower()
        if scenario_key == "cloud_burst":
            try:
                res = subprocess.run(
                    ssh_base + [f"pct stop {container_id} || true"],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=False,
                )
                return res.returncode == 0
            except Exception:
                return False

        placement_env = self.docker_dir / ".env.placement"
        if not placement_env.exists():
            return False

        try:
            # Ensure container is started before pushing config
            subprocess.run(
                ssh_base + [f"pct status {container_id} | grep -q running || pct start {container_id}"],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )

            scp_res = subprocess.run(
                [
                    "scp",
                    "-o",
                    "StrictHostKeyChecking=no",
                    "-o",
                    "ConnectTimeout=3",
                    str(placement_env),
                    f"root@{pve_host}:/tmp/.env.placement",
                ],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if scp_res.returncode != 0:
                return False

            caddyfile = self.docker_dir / "Caddyfile.ingress"
            push_caddy_cmd = ""
            if caddyfile.exists():
                scp_caddy = subprocess.run(
                    [
                        "scp",
                        "-o",
                        "StrictHostKeyChecking=no",
                        "-o",
                        "ConnectTimeout=3",
                        str(caddyfile),
                        f"root@{pve_host}:/tmp/Caddyfile.ingress",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
                if scp_caddy.returncode == 0:
                    push_caddy_cmd = (
                        f"pct push {container_id} /tmp/Caddyfile.ingress /opt/quota-pay/docker/Caddyfile.ingress && "
                        "rm -f /tmp/Caddyfile.ingress && "
                    )

            if scenario_key == "all_edge":
                compose_action = (
                    f"pct exec {container_id} -- bash -lc 'cd /opt/quota-pay/docker && "
                    "docker compose -f docker-compose.edge.yml --env-file .env.placement "
                    "up -d quota-web-frontend quota-ai-proxy && "
                    "docker compose -f docker-compose.edge.yml --env-file .env.placement "
                    "up -d --force-recreate quota-ingress'"
                )
            else:
                # Hybrid: edge handles ingress + frontend and stops local ai-proxy so /api/* routes to AWS
                compose_action = (
                    f"pct exec {container_id} -- bash -lc 'cd /opt/quota-pay/docker && "
                    "docker stop quota-edge-ai-proxy >/dev/null 2>&1 || true; "
                    "docker compose -f docker-compose.edge.yml --env-file .env.placement "
                    "up -d quota-web-frontend && "
                    "docker compose -f docker-compose.edge.yml --env-file .env.placement "
                    "up -d --force-recreate quota-ingress'"
                )

            remote_cmd = (
                f"{push_caddy_cmd}"
                f"pct push {container_id} /tmp/.env.placement /opt/quota-pay/docker/.env.placement && "
                f"pct push {container_id} /tmp/.env.placement /opt/quota-pay/docker/.env && "
                f"rm -f /tmp/.env.placement && {compose_action}"
            )
            ssh_res = subprocess.run(
                ssh_base + [remote_cmd],
                capture_output=True,
                text=True,
                timeout=45,
                check=False,
            )
            return ssh_res.returncode == 0
        except Exception:
            return False

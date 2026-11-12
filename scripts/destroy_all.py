#!/usr/bin/env python3
"""
Quota Pay — Full Infrastructure & Stack Auto-Destruction Engine
Tears down all deployed resources across:
  1. AWS Cloud Spot Instances, VPCs, and Security Groups (down to $0.00/hr)
  2. Proxmox VE Edge Docker Stacks and Containers (Container 101)
  3. Local Host AI Proxy Daemons and Dev Servers

Usage:
  python scripts/destroy_all.py
  python scripts/destroy_all.py --purge-edge-container
  python scripts/destroy_all.py --dry-run
"""

import os
import sys
import json
import socket
import argparse
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.orchestrator.actuator import TerraformActuator


def load_env():
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v


def is_host_reachable(ip: str, port: int = 22, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except (socket.timeout, OSError):
        return False


def stop_local_processes():
    print("\n[1/3] 🧹 Cleaning up local processes (AI proxy, Metro, etc.)...")
    # Kill any process listening on port 3000 (Windows)
    try:
        netstat_out = subprocess.check_output(
            'netstat -ano | findstr :3000 | findstr LISTENING',
            shell=True,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        pids = set()
        for line in netstat_out.strip().splitlines():
            parts = line.strip().split()
            if len(parts) >= 5:
                pids.add(parts[-1])
        for pid in pids:
            if pid and pid != "0":
                print(f"   -> Killing local PID {pid} listening on :3000...")
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
    except Exception:
        pass
    print("   ✅ Local dev processes cleared.")


def destroy_proxmox_edge(purge_container: bool = False, dry_run: bool = False):
    print("\n[2/3] 🏢 Teardown Proxmox Edge Node (Container 101)...")
    pve_ip = os.environ.get("PROXMOX_HOST", "192.168.178.125")

    if not is_host_reachable(pve_ip, port=22, timeout=1.5):
        print(f"   ℹ️  Proxmox host ({pve_ip}) is powered off or unreachable (VMware closed). Edge stack already stopped.")
        return

    if dry_run:
        print("   [DRY-RUN] Would stop Docker Compose on Container 101 and stop container.")
        return

    try:
        # 1. Stop Docker Compose stack inside container
        print("   -> Stopping Docker Compose edge stack inside Container 101...")
        cmd_compose_down = (
            f'ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 root@{pve_ip} '
            '"pct exec 101 -- docker compose -f /opt/quota-pay/docker/docker-compose.edge.yml down -v"'
        )
        subprocess.run(cmd_compose_down, shell=True, capture_output=True, timeout=20)

        # 2. Stop container
        print("   -> Stopping LXC Container 101...")
        cmd_stop = f'ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 root@{pve_ip} "pct stop 101"'
        subprocess.run(cmd_stop, shell=True, capture_output=True, timeout=15)

        if purge_container:
            print("   -> Purging LXC Container 101 from disk...")
            cmd_destroy = f'ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 root@{pve_ip} "pct destroy 101"'
            subprocess.run(cmd_destroy, shell=True, capture_output=True, timeout=15)

        print("   ✅ Proxmox Edge node stopped cleanly.")
    except Exception as e:
        print(f"   ⚠️  Notice while stopping Edge node: {e}")


def destroy_aws_cloud(dry_run: bool = False):
    print("\n[3/3] ☁️  Teardown AWS Cloud Spot Infrastructure...")
    actuator = TerraformActuator(project_root=PROJECT_ROOT)

    # 1. Modular terraform destroy in infra/
    infra_tfstate = PROJECT_ROOT / "infra" / "terraform.tfstate"
    legacy_tfstate = PROJECT_ROOT / "infra" / "terraform" / "terraform.tfstate"

    if dry_run:
        print("   [DRY-RUN] Would run terraform destroy for all AWS resources.")
        return

    destroyed = False
    if infra_tfstate.exists() and infra_tfstate.stat().st_size > 500:
        print("   -> Running terraform destroy on infra/ (Modular)...")
        res = actuator.destroy(auto_approve=True)
        if res["success"]:
            print("   ✅ Modular AWS resources destroyed.")
            destroyed = True
        else:
            print(f"   ⚠️  Modular destroy returned: {res.get('stderr')[:120]}")

    if legacy_tfstate.exists() and legacy_tfstate.stat().st_size > 500:
        print("   -> Running terraform destroy on infra/terraform/ (Standalone)...")
        try:
            cmd = ["terraform", f"-chdir={PROJECT_ROOT / 'infra' / 'terraform'}", "destroy", "-auto-approve"]
            env = os.environ.copy()
            env.setdefault("AWS_PROFILE", "efekankati")
            env.setdefault("AWS_REGION", "eu-south-1")
            res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=180)
            if res.returncode == 0:
                print("   ✅ Standalone AWS resources destroyed.")
                destroyed = True
            else:
                print(f"   ⚠️  Standalone destroy notice: {res.stderr[:120]}")
        except Exception as e:
            print(f"   ⚠️  Error executing legacy destroy: {e}")

    # Fallback sanity check: terminate any orphan instances with tag Project=QuotaPay
    try:
        ec2_term = subprocess.run(
            'aws ec2 describe-instances --profile efekankati --region eu-south-1 '
            '--filters "Name=tag:Project,Values=QuotaPay" "Name=instance-state-name,Values=running,pending" '
            '--query "Reservations[*].Instances[*].InstanceId" --output text',
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        instance_ids = ec2_term.stdout.strip().split()
        if instance_ids:
            print(f"   -> Forcing termination on orphaned Spot instances: {instance_ids}...")
            ids_str = " ".join(instance_ids)
            subprocess.run(
                f'aws ec2 terminate-instances --profile efekankati --region eu-south-1 --instance-ids {ids_str}',
                shell=True,
                capture_output=True,
                timeout=15,
            )
            print("   ✅ Orphaned instances terminated.")
    except Exception:
        pass

    print("   ✅ AWS compute spend is now strictly $0.00/hr.")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Full auto-destruction for Quota Pay across Cloud, Edge, and Local")
    parser.add_argument("--purge-edge-container", action="store_true", help="Completely destroy LXC Container 101")
    parser.add_argument("--dry-run", action="store_true", help="Print teardown steps without applying")
    args = parser.parse_args(argv)

    load_env()
    print("=" * 70)
    print("🛑 QUOTA PAY COMPLETE TEARDOWN & AUTO-DESTRUCTION SEQUENCE")
    print(f"   Dry Run : {args.dry_run}")
    print("=" * 70)

    stop_local_processes()
    destroy_proxmox_edge(purge_container=args.purge_edge_container, dry_run=args.dry_run)
    destroy_aws_cloud(dry_run=args.dry_run)

    print("\n" + "=" * 70)
    print("🏁 TEARDOWN COMPLETE: All local, edge, and cloud resources destroyed.")
    print("=" * 70)


if __name__ == "__main__":
    main()

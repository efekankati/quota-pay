#!/usr/bin/env python3
"""
Helper invoked by Terraform local-exec after creating a Proxmox LXC container.
Installs Docker + Git inside the container via `pct exec`, clones Quota Pay,
syncs `.env` if present, configures systemd auto-start, and launches services.
"""

import re
import subprocess
import sys
import time
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def get_proxmox_host() -> str:
    root = _repo_root()
    possible_paths = [
        root / "infra" / "proxmox.auto.tfvars",
        Path.cwd() / "proxmox.auto.tfvars",
        Path.cwd() / "infra" / "proxmox.auto.tfvars",
    ]
    for p in possible_paths:
        if p.exists():
            m = re.search(r'proxmox_endpoint\s*=\s*"https?://([^:/"]+)', p.read_text(encoding="utf-8"))
            if m:
                return m.group(1)
    return "192.168.178.125"


def main():
    if len(sys.argv) < 5:
        print("Usage: bootstrap_lxc.py <vm_id> <git_branch> <compose_target> <services_space_sep>")
        sys.exit(0)

    vm_id = sys.argv[1]
    git_branch = sys.argv[2] or "main"
    compose_target = sys.argv[3] or "docker-compose.edge.yml"
    services = " ".join(sys.argv[4:]).strip()
    pve_host = get_proxmox_host()
    ssh_base = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", f"root@{pve_host}"]

    # Wait briefly for container network & systemd
    for _ in range(15):
        probe = subprocess.run(ssh_base + [f"pct exec {vm_id} -- true"], capture_output=True, text=True)
        if probe.returncode == 0:
            break
        time.sleep(2)

    setup_script = (
        f"pct exec {vm_id} -- bash -lc '"
        "export DEBIAN_FRONTEND=noninteractive && "
        "apt-get update -qq && apt-get install -y -qq curl git ca-certificates && "
        "mkdir -p /etc/ssh/sshd_config.d && "
        "printf \"PasswordAuthentication no\\nPermitRootLogin prohibit-password\\nPubkeyAuthentication yes\\n\" "
        "> /etc/ssh/sshd_config.d/99-quota-hardening.conf && "
        "(systemctl reload ssh || systemctl reload sshd || true) && "
        "if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi && "
        "systemctl enable --now docker && "
        "rm -rf /opt/quota-pay && "
        f"(git clone -b {git_branch} https://github.com/efekankati/quota-pay.git /opt/quota-pay || "
        "git clone https://github.com/efekankati/quota-pay.git /opt/quota-pay)"
        "'"
    )
    subprocess.run(ssh_base + [setup_script], check=True)

    # Copy root .env into container if available locally
    project_root = _repo_root()
    local_env = project_root / ".env"
    if local_env.exists():
        subprocess.run(
            ["scp", "-o", "StrictHostKeyChecking=no", str(local_env), f"root@{pve_host}:/tmp/.env.{vm_id}"],
            check=False,
        )
        subprocess.run(
            ssh_base
            + [
                f"pct push {vm_id} /tmp/.env.{vm_id} /opt/quota-pay/.env && "
                f"pct push {vm_id} /tmp/.env.{vm_id} /opt/quota-pay/docker/.env && "
                f"rm -f /tmp/.env.{vm_id}"
            ],
            check=False,
        )

    launch_cmd = (
        f"pct exec {vm_id} -- bash -lc '"
        f"cd /opt/quota-pay && docker compose -f docker/{compose_target} up -d --build {services}"
        "'"
    )
    subprocess.run(ssh_base + [launch_cmd], check=True)
    print(f"[bootstrap_lxc] Container {vm_id} bootstrapped and running {services or compose_target}.")


if __name__ == "__main__":
    main()

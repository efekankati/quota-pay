#!/usr/bin/env python3
"""
Helper script invoked by Terraform local-exec provisioner on Proxmox node creation.
Disables KVM hardware virtualization requirement (kvm: 0) on non-nested hosts,
then signals Proxmox VE to start the VM cleanly.
"""

import re
import ssl
import sys
import urllib.request
from pathlib import Path


def get_proxmox_credentials():
    """Extracts endpoint and token from infra/proxmox.auto.tfvars or environment."""
    endpoint = "https://192.168.178.125:8006"
    token = ""

    # Look for proxmox.auto.tfvars in infra directory
    possible_paths = [
        Path(__file__).resolve().parent.parent.parent.parent / "infra" / "proxmox.auto.tfvars",
        Path(__file__).resolve().parent.parent.parent / "proxmox.auto.tfvars",
        Path.cwd() / "proxmox.auto.tfvars",
        Path.cwd() / "infra" / "proxmox.auto.tfvars",
    ]

    for tfvars_path in possible_paths:
        if tfvars_path.exists():
            try:
                content = tfvars_path.read_text(encoding="utf-8")
                ep_match = re.search(r'proxmox_endpoint\s*=\s*"([^"]+)"', content)
                tok_match = re.search(r'proxmox_api_token\s*=\s*"([^"]+)"', content)
                if ep_match:
                    endpoint = ep_match.group(1).rstrip("/")
                if tok_match:
                    token = f"PVEAPIToken={tok_match.group(1)}"
                if token:
                    break
            except Exception:
                pass

    return endpoint, token


def main():
    if len(sys.argv) < 3:
        print("[start_vm_no_kvm] Usage: python start_vm_no_kvm.py <node_name> <vm_id>")
        sys.exit(0)

    node_name = sys.argv[1]
    vm_id = sys.argv[2]
    endpoint, token = get_proxmox_credentials()

    ctx = ssl._create_unverified_context()

    # 1. Disable KVM requirement (kvm: 0)
    try:
        config_url = f"{endpoint}/api2/json/nodes/{node_name}/qemu/{vm_id}/config"
        req = urllib.request.Request(
            config_url,
            data=b"kvm=0",
            headers={"Authorization": token},
            method="PUT",
        )
        urllib.request.urlopen(req, context=ctx)
        print(f"[start_vm_no_kvm] Successfully set kvm=0 on VM {vm_id}")
    except Exception as e:
        print(f"[start_vm_no_kvm] Notice during setting kvm=0: {e}")

    # 2. Trigger VM start
    try:
        start_url = f"{endpoint}/api2/json/nodes/{node_name}/qemu/{vm_id}/status/start"
        req = urllib.request.Request(
            start_url,
            data=b"",
            headers={"Authorization": token},
            method="POST",
        )
        urllib.request.urlopen(req, context=ctx)
        print(f"[start_vm_no_kvm] Successfully signaled start for VM {vm_id}")
    except Exception as e:
        print(f"[start_vm_no_kvm] Notice during VM start: {e}")


if __name__ == "__main__":
    main()

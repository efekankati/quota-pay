# =============================================================================
# AUTONOMOUSLY AUTHORED BY AGENT 1 (terraform_author_agent)
# Directive ID : dir-2027e42cb3
# Source       : mock-proxmox-first
# Scenario     : all_edge
# Revision     : 0
# Generated At : 2026-11-22T16:41:28.047459+00:00
# Author Notes :
#   - Authored initial Proxmox-first Terraform config for scenario='all_edge' (enable_aws=False, nodes=['edge-primary']).
# =============================================================================

locals {
  agent_pipeline_spec = {
    directive_id            = "dir-2027e42cb3"
    source                  = "mock-proxmox-first"
    scenario                = "all_edge"
    revision                = 0
    proxmox_first           = true
    aws_opt_in_enabled      = false
    ssh_password_auth_off   = true
    ssh_allowed_cidr        = "192.168.178.0/24"
    allowed_ingress_cidrs   = ["192.168.178.0/24"]
    authored_nodes = {
    "edge-primary" = {
      provider            = "proxmox"
      target_node         = "pve"
      cpu_cores           = 2
      memory_mb           = 1024
      disk_gb             = 8
      virtualization_type = "lxc"
      enable_firewall     = true
      allowed_ports       = [80, 443]
      services            = ["quota-ingress", "quota-web-frontend", "quota-ai-proxy"]
    }
    }
  }
}

output "agent_deployment_manifest" {
  description = "Structured manifest authored by Agent 1 and validated by Agent 2"
  value = {
    spec              = local.agent_pipeline_spec
    active_proxmox    = keys(module.proxmox_nodes)
    active_aws        = keys(module.aws_spot_nodes)
    aws_gate_open     = var.enable_aws
  }
}

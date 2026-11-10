# =============================================================================
# Root Orchestration Blueprint — Outputs
# =============================================================================

output "edge_nodes" {
  description = "Deployed Proxmox VE edge virtual machines"
  value = {
    for k, node in module.proxmox_nodes : k => {
      provider       = "proxmox"
      vm_id          = node.vm_id
      vm_name        = node.vm_name
      node_name      = node.node_name
      services       = node.services
      compose_target = node.compose_target
      ipv4_addresses = node.ipv4_address
    }
  }
}

output "cloud_nodes" {
  description = "Deployed AWS Spot cloud instances"
  value = {
    for k, node in module.aws_spot_nodes : k => {
      provider        = "aws"
      instance_id     = node.instance_id
      public_ip       = node.public_ip
      spot_request_id = node.spot_request_id
      services        = node.services
      compose_target  = node.compose_target
    }
  }
}

output "placement_topology" {
  description = "Full service-to-node topology summary"
  value = {
    total_nodes = length(module.proxmox_nodes) + length(module.aws_spot_nodes)
    proxmox_vms = keys(module.proxmox_nodes)
    aws_spots   = keys(module.aws_spot_nodes)
  }
}

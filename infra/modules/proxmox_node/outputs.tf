output "vm_id" {
  value       = var.virtualization_type == "lxc" ? proxmox_virtual_environment_container.edge_lxc[0].id : proxmox_virtual_environment_vm.edge_node[0].id
  description = "Proxmox container/VM unique identifier"
}

output "node_name" {
  value       = var.node_name
  description = "Proxmox physical host node where the VM/container is placed"
}

output "vm_name" {
  value       = var.virtualization_type == "lxc" ? proxmox_virtual_environment_container.edge_lxc[0].initialization[0].hostname : proxmox_virtual_environment_vm.edge_node[0].name
  description = "Assigned virtual machine or container hostname"
}

output "ipv4_address" {
  value       = var.virtualization_type == "lxc" ? values(proxmox_virtual_environment_container.edge_lxc[0].ipv4) : flatten(proxmox_virtual_environment_vm.edge_node[0].ipv4_addresses)
  description = "Assigned IPv4 network addresses"
}

output "services" {
  value       = var.services
  description = "Services placed on this edge node"
}

output "compose_target" {
  value       = var.compose_target
  description = "Target Docker Compose profile deployed"
}

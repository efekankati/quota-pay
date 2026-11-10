output "vm_id" {
  value       = proxmox_virtual_environment_vm.edge_node.id
  description = "Proxmox VM unique identifier"
}

output "node_name" {
  value       = var.node_name
  description = "Proxmox physical host node where the VM is placed"
}

output "vm_name" {
  value       = proxmox_virtual_environment_vm.edge_node.name
  description = "Assigned virtual machine hostname"
}

output "ipv4_address" {
  value       = proxmox_virtual_environment_vm.edge_node.ipv4_addresses
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

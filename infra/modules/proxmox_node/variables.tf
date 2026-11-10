variable "node_name" {
  type        = string
  description = "Target Proxmox VE host node name (e.g. pve, node-01)"
  default     = "pve"
}

variable "vm_name" {
  type        = string
  description = "Name identifier for the created Proxmox VM"
  default     = null
}

variable "cores" {
  type        = number
  description = "Allocated CPU cores for the edge virtual machine"
  default     = 2
}

variable "memory_mb" {
  type        = number
  description = "Dedicated RAM memory in megabytes"
  default     = 1024
}

variable "disk_gb" {
  type        = number
  description = "Root disk size in gigabytes"
  default     = 20
}

variable "cloud_init_image" {
  type        = string
  description = "Base Cloud-Init OS image reference (e.g. ubuntu-24.04-cloudimg)"
  default     = "local:iso/ubuntu-24.04-server-cloudimg-amd64.img"
}

variable "compose_target" {
  type        = string
  description = "Target Docker Compose file to execute on boot (e.g. docker-compose.edge.yml)"
  default     = "docker-compose.edge.yml"
}

variable "services" {
  type        = list(string)
  description = "List of Quota Pay services assigned to this Proxmox node"
  default     = ["quota-web-frontend", "quota-ingress"]
}

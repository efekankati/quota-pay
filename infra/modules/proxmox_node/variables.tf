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
  default     = 8
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

variable "virtualization_type" {
  type        = string
  description = "Proxmox virtualization mode: 'lxc' (container, works without nested VT-x) or 'qemu' (full VM)"
  default     = "lxc"
}

variable "lxc_template" {
  type        = string
  description = "Proxmox LXC OS template reference"
  default     = "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst"
}

variable "git_branch" {
  type        = string
  description = "Git branch cloned inside the bootstrapped Proxmox node"
  default     = "main"
}

variable "enable_firewall" {
  type        = bool
  description = "Enable Proxmox VE per-container/VM firewall with default-drop ingress policy"
  default     = true
}

variable "allowed_ports" {
  type        = list(number)
  description = "TCP service ports permitted inbound through Proxmox firewall"
  default     = [80, 443]
}

variable "allowed_cidrs" {
  type        = list(string)
  description = "Allowed source CIDRs for inbound service traffic"
  default     = ["192.168.178.0/24"]
}

variable "ssh_allowed_cidr" {
  type        = string
  description = "Restricted management CIDR allowed to access SSH (TCP/22)"
  default     = "192.168.178.0/24"
}

variable "disable_password_auth" {
  type        = bool
  description = "Enforce SSH key-only authentication inside provisioned Proxmox nodes"
  default     = true
}

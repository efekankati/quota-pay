terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = ">= 0.60.0"
    }
  }
}

# =============================================================================
# 1. Cloud-Init Snippet File Registration on Proxmox Datastore (QEMU mode)
# =============================================================================
resource "proxmox_virtual_environment_file" "cloud_init" {
  count        = var.virtualization_type == "qemu" ? 1 : 0
  content_type = "snippets"
  datastore_id = "local"
  node_name    = var.node_name

  source_raw {
    data = templatefile("${path.module}/cloud_init.yaml", {
      compose_target = var.compose_target
      services       = var.services
    })
    file_name = "quota-${coalesce(var.vm_name, var.node_name)}-user-data.yaml"
  }
}

# =============================================================================
# 2A. Native LXC Container Definition (Works cleanly without nested VT-x)
# =============================================================================
resource "proxmox_virtual_environment_container" "edge_lxc" {
  count         = var.virtualization_type == "lxc" ? 1 : 0
  node_name     = var.node_name
  description   = "Quota Pay Edge LXC (${join(", ", var.services)}) [FIGARO Orchestrated]"
  tags          = ["quota-pay", "edge", "figaro"]
  start_on_boot = true
  unprivileged  = false

  features {
    nesting = true
  }

  cpu {
    cores = var.cores
  }

  memory {
    dedicated = var.memory_mb
  }

  disk {
    datastore_id = "local-lvm"
    size         = var.disk_gb
  }

  network_interface {
    name   = "eth0"
    bridge = "vmbr0"
  }

  operating_system {
    template_file_id = var.lxc_template
    type             = "ubuntu"
  }

  initialization {
    hostname = coalesce(var.vm_name, "quota-edge-${var.node_name}")
    ip_config {
      ipv4 {
        address = "dhcp"
      }
    }
  }

  provisioner "local-exec" {
    command = "python ${path.module}/scripts/bootstrap_lxc.py ${self.vm_id} ${var.git_branch} ${var.compose_target} ${join(" ", var.services)}"
  }
}

# =============================================================================
# 2B. Virtual Machine Definition with Dynamic Resources & Cloud-Init (QEMU mode)
# =============================================================================
resource "proxmox_virtual_environment_vm" "edge_node" {
  count       = var.virtualization_type == "qemu" ? 1 : 0
  name        = coalesce(var.vm_name, "quota-edge-${var.node_name}")
  node_name   = var.node_name
  description = "Quota Pay Edge Node (${join(", ", var.services)}) [FIGARO Orchestrated]"
  tags        = ["quota-pay", "edge", "figaro"]
  started     = false

  cpu {
    cores = var.cores
    type  = "qemu64"
  }

  memory {
    dedicated = var.memory_mb
  }

  disk {
    datastore_id = "local-lvm"
    size         = var.disk_gb
    interface    = "scsi0"
    file_format  = "raw"
  }

  network_device {
    bridge = "vmbr0"
    model  = "virtio"
  }

  initialization {
    ip_config {
      ipv4 {
        address = "dhcp"
      }
    }
    user_data_file_id = proxmox_virtual_environment_file.cloud_init[0].id
  }

  provisioner "local-exec" {
    command = "python ${path.module}/scripts/start_vm_no_kvm.py ${self.node_name} ${self.vm_id}"
  }
}

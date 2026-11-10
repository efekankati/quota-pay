terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = ">= 0.60.0"
    }
  }
}

# =============================================================================
# 1. Cloud-Init Snippet File Registration on Proxmox Datastore
# =============================================================================
resource "proxmox_virtual_environment_file" "cloud_init" {
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
# 2. Virtual Machine Definition with Dynamic Resources & Cloud-Init
# =============================================================================
resource "proxmox_virtual_environment_vm" "edge_node" {
  name        = coalesce(var.vm_name, "quota-edge-${var.node_name}")
  node_name   = var.node_name
  description = "Quota Pay Edge Node (${join(", ", var.services)}) [FIGARO Orchestrated]"
  tags        = ["quota-pay", "edge", "figaro"]

  cpu {
    cores = var.cores
    type  = "host"
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
    user_data_file_id = proxmox_virtual_environment_file.cloud_init.id
  }
}

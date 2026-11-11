terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    proxmox = {
      source  = "bpg/proxmox"
      version = ">= 0.60.0"
    }
  }
}

# =============================================================================
# 1. Cloud & Edge Providers
# =============================================================================
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token
  insecure  = var.proxmox_insecure

  ssh {
    agent       = false
    username    = "root"
    password    = var.proxmox_password != "" ? var.proxmox_password : null
    private_key = try(file(pathexpand(var.proxmox_ssh_private_key_file)), null)
  }
}

# =============================================================================
# 2. Shared AWS Networking (Dynamically provisioned if any node is placed on AWS)
# =============================================================================
locals {
  has_aws_nodes = length([for k, v in var.placement_plan : k if v.target_provider == "aws"]) > 0
}

resource "aws_vpc" "quota_vpc" {
  count                = local.has_aws_nodes ? 1 : 0
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "quota-pay-vpc"
    Project     = "QuotaPay"
    Environment = "production"
    ManagedBy   = "FIGARO-Orchestrator"
  }
}

resource "aws_subnet" "quota_public_subnet" {
  count                   = local.has_aws_nodes ? 1 : 0
  vpc_id                  = aws_vpc.quota_vpc[0].id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name        = "quota-pay-public-subnet"
    Project     = "QuotaPay"
    Environment = "production"
  }
}

resource "aws_internet_gateway" "quota_igw" {
  count  = local.has_aws_nodes ? 1 : 0
  vpc_id = aws_vpc.quota_vpc[0].id

  tags = {
    Name    = "quota-pay-igw"
    Project = "QuotaPay"
  }
}

resource "aws_route_table" "quota_public_rt" {
  count  = local.has_aws_nodes ? 1 : 0
  vpc_id = aws_vpc.quota_vpc[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.quota_igw[0].id
  }

  tags = {
    Name    = "quota-pay-public-rt"
    Project = "QuotaPay"
  }
}

resource "aws_route_table_association" "quota_public_rta" {
  count          = local.has_aws_nodes ? 1 : 0
  subnet_id      = aws_subnet.quota_public_subnet[0].id
  route_table_id = aws_route_table.quota_public_rt[0].id
}

resource "aws_security_group" "quota_sg" {
  count       = local.has_aws_nodes ? 1 : 0
  name        = "quota-pay-multi-node-sg"
  description = "Allow HTTP, HTTPS, and API Proxy ingress"
  vpc_id      = aws_vpc.quota_vpc[0].id

  ingress {
    description = "HTTP Ingress"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS Ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "AI Proxy Backend Port"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Full Outbound Egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "quota-pay-multi-node-sg"
    Project = "QuotaPay"
  }
}

# =============================================================================
# 3. Dynamic Node Placement Engine (Proxmox VE + AWS Spot)
# =============================================================================

# Module 1: Proxmox VE Edge Nodes
module "proxmox_nodes" {
  source   = "./modules/proxmox_node"
  for_each = { for k, v in var.placement_plan : k => v if v.target_provider == "proxmox" }

  node_name      = each.value.target_node != null ? each.value.target_node : "pve"
  vm_name        = "quota-${each.key}"
  cores          = each.value.cpu_cores
  memory_mb      = each.value.memory_mb
  services       = each.value.services
  compose_target = "docker-compose.edge.yml"
}

# Module 2: AWS Spot Cloud Nodes
module "aws_spot_nodes" {
  source   = "./modules/aws_spot_node"
  for_each = { for k, v in var.placement_plan : k => v if v.target_provider == "aws" }

  name              = "quota-${each.key}"
  instance_type     = each.value.cpu_cores > 1 ? "t3.small" : "t3.micro"
  subnet_id         = aws_subnet.quota_public_subnet[0].id
  security_group_id = aws_security_group.quota_sg[0].id
  compose_target    = "docker-compose.cloud.yml"
  spot_max_price    = var.spot_max_price
  services          = each.value.services
  gemini_api_key    = var.gemini_api_key
  supabase_url      = var.supabase_url
  supabase_anon_key = var.supabase_anon_key
  ai_max_budget_usd = var.ai_max_budget_usd
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Latest Amazon Linux 2023 AMI in eu-south-1 (x86_64)
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# =============================================================================
# AWS Spot Instance Deployment (FinOps Optimized)
# =============================================================================
resource "aws_instance" "spot_node" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  associate_public_ip_address          = true
  instance_initiated_shutdown_behavior = "terminate"

  instance_market_options {
    market_type = "spot"

    spot_options {
      max_price                      = var.spot_max_price
      spot_instance_type             = "one-time"
      instance_interruption_behavior = "terminate"
    }
  }

  root_block_device {
    volume_size           = 16
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    compose_target    = var.compose_target
    services          = join(", ", var.services)
    gemini_api_key    = var.gemini_api_key
    supabase_url      = var.supabase_url
    supabase_anon_key = var.supabase_anon_key
    ai_max_budget_usd = var.ai_max_budget_usd
  })

  tags = {
    Name        = var.name
    Project     = "QuotaPay"
    Environment = "production"
    FinOpsMode  = "Spot-Ephemeral"
    Services    = join(", ", var.services)
    ManagedBy   = "FIGARO-Placement-Orchestrator"
  }
}

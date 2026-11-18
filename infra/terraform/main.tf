terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# =============================================================================
# 1. AWS Provider — Strictly Pinned to eu-south-1 (Milan) via Profile `efekankati`
# =============================================================================
provider "aws" {
  region  = "eu-south-1"
  profile = var.aws_profile
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
# 2. Minimal-Cost VPC & Public Subnet (Zero NAT Gateway / Zero ALB Spend)
# =============================================================================
resource "aws_vpc" "quota_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "quota-pay-vpc"
    Project     = "QuotaPay"
    Environment = "production"
    ManagedBy   = "Terraform-FinOps"
  }
}

resource "aws_subnet" "quota_public_subnet" {
  vpc_id                  = aws_vpc.quota_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "eu-south-1a"
  map_public_ip_on_launch = true

  tags = {
    Name        = "quota-pay-public-subnet-eu-south-1a"
    Project     = "QuotaPay"
    Environment = "production"
  }
}

resource "aws_internet_gateway" "quota_igw" {
  vpc_id = aws_vpc.quota_vpc.id

  tags = {
    Name        = "quota-pay-igw"
    Project     = "QuotaPay"
    Environment = "production"
  }
}

resource "aws_route_table" "quota_public_rt" {
  vpc_id = aws_vpc.quota_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.quota_igw.id
  }

  tags = {
    Name        = "quota-pay-public-rt"
    Project     = "QuotaPay"
    Environment = "production"
  }
}

resource "aws_route_table_association" "quota_public_rta" {
  subnet_id      = aws_subnet.quota_public_subnet.id
  route_table_id = aws_route_table.quota_public_rt.id
}

# =============================================================================
# 3. Security Group — Allow Inbound HTTP (80) & HTTPS (443), Open Egress
# =============================================================================
resource "aws_security_group" "quota_sg" {
  name        = "quota-pay-web-sg"
  description = "Allow HTTP (80) and HTTPS (443) inbound; open egress for Gemini AI & Supabase"
  vpc_id      = aws_vpc.quota_vpc.id

  ingress {
    description      = "HTTP Inbound"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTPS Inbound (Caddy Lets Encrypt)"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    description      = "Open Outbound Egress"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "quota-pay-sg"
    Project     = "QuotaPay"
    Environment = "production"
  }
}

# =============================================================================
# 4. Single EC2 Spot Instance (t3.small) — No ALB, No ECS Fargate
# =============================================================================
resource "aws_instance" "quota_spot_server" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.quota_public_subnet.id
  vpc_security_group_ids      = [aws_security_group.quota_sg.id]
  associate_public_ip_address          = true
  user_data_replace_on_change          = true
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
    domain_name       = var.domain_name
    gemini_api_key    = var.gemini_api_key
    supabase_url      = var.supabase_url
    supabase_anon_key = var.supabase_anon_key
    ai_max_budget_usd = var.ai_max_budget_usd
  })

  tags = {
    Name        = "quota-pay-spot-server-eu-south-1"
    Project     = "QuotaPay"
    Environment = "production"
    FinOpsMode  = "Spot-Ephemeral"
  }
}


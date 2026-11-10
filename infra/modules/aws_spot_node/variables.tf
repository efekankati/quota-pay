variable "name" {
  type        = string
  description = "Identifier for the AWS Spot node"
  default     = "quota-cloud-spot"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type (e.g. t3.small, t3.medium)"
  default     = "t3.small"
}

variable "subnet_id" {
  type        = string
  description = "VPC Subnet ID where the Spot instance is placed"
}

variable "security_group_id" {
  type        = string
  description = "Security Group ID allowing HTTP/HTTPS traffic"
}

variable "compose_target" {
  type        = string
  description = "Target compose profile to execute (e.g. docker-compose.cloud.yml)"
  default     = "docker-compose.cloud.yml"
}

variable "spot_max_price" {
  type        = string
  description = "Maximum hourly Spot bid price in USD"
  default     = "0.015"
}

variable "services" {
  type        = list(string)
  description = "List of services placed on this cloud node"
  default     = ["quota-ai-proxy"]
}

variable "gemini_api_key" {
  type        = string
  description = "Gemini multimodal API key for receipt OCR"
  default     = ""
  sensitive   = true
}

variable "supabase_url" {
  type        = string
  description = "Supabase project URL"
  default     = "https://nnamvsnorjbsruwhkker.supabase.co"
}

variable "supabase_anon_key" {
  type        = string
  description = "Supabase anonymous public key"
  default     = ""
  sensitive   = true
}

variable "ai_max_budget_usd" {
  type        = string
  description = "FinOps monthly maximum budget limit for AI proxy"
  default     = "5.00"
}

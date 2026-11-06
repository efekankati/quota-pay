variable "aws_region" {
  description = "AWS deployment region (strictly pinned to Milan eu-south-1 for Italian fintech compliance & low latency)"
  type        = string
  default     = "eu-south-1"
}

variable "aws_profile" {
  description = "Local AWS CLI shared configuration/SSO profile name (authenticates without hardcoded access/secret keys)"
  type        = string
  default     = "efekankati"
}

variable "instance_type" {
  description = "EC2 Spot instance type (~$0.005/hr in eu-south-1)"
  type        = string
  default     = "t3.small"
}

variable "spot_max_price" {
  description = "Maximum hourly Spot price cap in USD (~70% discount over On-Demand)"
  type        = string
  default     = "0.015"
}

variable "domain_name" {
  description = "Domain name for Caddy automatic Let's Encrypt HTTPS (defaults to :80 if using raw IP)"
  type        = string
  default     = ":80"
}

variable "gemini_api_key" {
  description = "Server-side Google Gemini API key injected into the container environment"
  type        = string
  sensitive   = true
  default     = ""
}

variable "supabase_url" {
  description = "Supabase PostgreSQL project URL"
  type        = string
  default     = "https://nnamvsnorjbsruwhkker.supabase.co"
}

variable "supabase_anon_key" {
  description = "Supabase publishable anon key"
  type        = string
  default     = "sb_publishable_VKw5r0KvReUqf5q3lwcIjg_Fte_AMPT"
}

variable "ai_max_budget_usd" {
  description = "Soft & hard monetary budget ceiling in USD before circuit breaker triggers"
  type        = string
  default     = "5.00"
}


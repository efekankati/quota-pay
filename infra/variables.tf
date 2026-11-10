# =============================================================================
# Root Orchestration Blueprint — Variables
# =============================================================================

variable "placement_plan" {
  type = map(object({
    target_provider = string # "proxmox" or "aws"
    target_node     = optional(string)
    cpu_cores       = number
    memory_mb       = number
    services        = list(string) # e.g. ["quota-ai-proxy"]
  }))
  description = "Unified multi-node placement plan produced by FIGARO orchestrator"
  default     = {}
}

# --- AWS Provider Configuration ---
variable "aws_region" {
  type        = string
  description = "AWS target region for cloud placement"
  default     = "eu-south-1"
}

variable "aws_profile" {
  type        = string
  description = "AWS named CLI profile"
  default     = "efekankati"
}

variable "spot_max_price" {
  type        = string
  description = "Spot bid cap in USD/hour"
  default     = "0.015"
}

variable "gemini_api_key" {
  type        = string
  description = "Gemini API Key"
  default     = ""
  sensitive   = true
}

variable "supabase_url" {
  type        = string
  description = "Supabase API Endpoint"
  default     = "https://nnamvsnorjbsruwhkker.supabase.co"
}

variable "supabase_anon_key" {
  type        = string
  description = "Supabase Anon Key"
  default     = ""
  sensitive   = true
}

variable "ai_max_budget_usd" {
  type        = string
  description = "AI proxy hard-cap budget limit in USD"
  default     = "5.00"
}

# --- Proxmox Provider Configuration ---
variable "proxmox_endpoint" {
  type        = string
  description = "Proxmox VE API URL (e.g. https://pve.local:8006/)"
  default     = "https://192.168.1.100:8006/"
}

variable "proxmox_api_token" {
  type        = string
  description = "Proxmox VE API Token (USER@REALM!TOKENID=UUID)"
  default     = "root@pam!terraform=00000000-0000-0000-0000-000000000000"
  sensitive   = true
}

variable "proxmox_insecure" {
  type        = bool
  description = "Disable TLS verification for self-signed Proxmox certificates"
  default     = true
}

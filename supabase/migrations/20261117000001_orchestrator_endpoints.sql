-- =============================================================================
-- Migration: 20261117000001_orchestrator_endpoints.sql
-- Purpose: Dynamic Cloud & Edge endpoint registry for mobile clients
-- Written by TerraformActuator after `terraform apply` so mobile APKs discover
-- ephemeral AWS Spot and Proxmox IPs without rebuilding client binaries.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orchestrator_endpoints (
  id TEXT PRIMARY KEY DEFAULT 'active',
  scenario TEXT NOT NULL DEFAULT 'hybrid',
  edge_url TEXT NOT NULL DEFAULT '',
  cloud_url TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default singleton row
INSERT INTO public.orchestrator_endpoints (id, scenario, edge_url, cloud_url, updated_at)
VALUES ('active', 'hybrid', 'http://192.168.178.128', 'http://15.160.125.0:3000', NOW())
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security with public read access for mobile client discovery
ALTER TABLE public.orchestrator_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to orchestrator_endpoints" ON public.orchestrator_endpoints;
CREATE POLICY "Allow public read access to orchestrator_endpoints"
  ON public.orchestrator_endpoints
  FOR SELECT
  USING (true);

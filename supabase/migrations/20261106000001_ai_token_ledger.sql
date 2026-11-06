-- =============================================================================
-- Migration: 20261106000001_ai_token_ledger.sql
-- Purpose: Unified AI Token & FinOps Monetary Ledger in Supabase PostgreSQL
-- Zero extra cloud databases (no DynamoDB/RDS). Tracks real-time Gemini token
-- consumption and enforces atomic budget circuit-breaking.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_token_ledger (
  id TEXT PRIMARY KEY DEFAULT 'global',
  total_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0.000000,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure the singleton global ledger row exists
INSERT INTO public.ai_token_ledger (id, total_tokens, estimated_cost_usd, is_paused, updated_at)
VALUES ('global', 0, 0.000000, FALSE, NOW())
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE public.ai_token_ledger ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated/anon status checks; mutations go through SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Allow read access to ai_token_ledger" ON public.ai_token_ledger;
CREATE POLICY "Allow read access to ai_token_ledger"
  ON public.ai_token_ledger
  FOR SELECT
  USING (true);

-- =============================================================================
-- Stored Procedure: record_gemini_tokens
-- Atomically increments token count and estimated USD spend, flips is_paused = TRUE
-- if estimated_cost_usd >= max_budget, and returns budget_exceeded BOOLEAN.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_gemini_tokens(
  tokens_to_add INT,
  cost_to_add NUMERIC,
  max_budget NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget_exceeded BOOLEAN;
  v_safe_tokens BIGINT := GREATEST(COALESCE(tokens_to_add, 0), 0);
  v_safe_cost NUMERIC(12, 6) := GREATEST(COALESCE(cost_to_add, 0.000000), 0.000000);
  v_safe_budget NUMERIC(12, 6) := GREATEST(COALESCE(max_budget, 5.000000), 0.000001);
BEGIN
  INSERT INTO public.ai_token_ledger (
    id,
    total_tokens,
    estimated_cost_usd,
    is_paused,
    updated_at
  )
  VALUES (
    'global',
    v_safe_tokens,
    v_safe_cost,
    (v_safe_cost >= v_safe_budget),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    total_tokens = public.ai_token_ledger.total_tokens + v_safe_tokens,
    estimated_cost_usd = public.ai_token_ledger.estimated_cost_usd + v_safe_cost,
    is_paused = (
      public.ai_token_ledger.is_paused
      OR ((public.ai_token_ledger.estimated_cost_usd + v_safe_cost) >= v_safe_budget)
    ),
    updated_at = NOW()
  RETURNING (is_paused OR (estimated_cost_usd >= v_safe_budget))
  INTO v_budget_exceeded;

  RETURN COALESCE(v_budget_exceeded, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_gemini_tokens(INT, NUMERIC, NUMERIC) TO anon, authenticated, service_role;

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface TokenUsageRecord {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface LedgerStatus {
  id: string;
  total_tokens: number;
  estimated_cost_usd: number;
  is_paused: boolean;
  max_budget_usd: number;
  budget_exceeded: boolean;
  updated_at: string;
}

export class SupabaseTokenLedger {
  private static supabase: SupabaseClient | null = null;

  // Local atomic mirror in case Supabase table migration is pending or unreachable
  private static localLedger: LedgerStatus = {
    id: 'global',
    total_tokens: 0,
    estimated_cost_usd: 0,
    is_paused: false,
    max_budget_usd: Number(process.env.AI_MAX_BUDGET_USD || 5.0),
    budget_exceeded: false,
    updated_at: new Date().toISOString(),
  };

  public static getMaxBudgetUsd(): number {
    const val = Number(process.env.AI_MAX_BUDGET_USD || 5.0);
    return Number.isFinite(val) && val > 0 ? val : 5.0;
  }

  private static getClient(): SupabaseClient | null {
    if (this.supabase) return this.supabase;

    const rawUrl = (
      process.env.SUPABASE_URL ||
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      'https://nnamvsnorjbsruwhkker.supabase.co'
    ).trim();
    const supabaseUrl = rawUrl.includes('supbase.com')
      ? rawUrl.replace('supbase.com', 'supabase.co')
      : rawUrl;

    const supabaseKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      ''
    ).trim();

    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
    return this.supabase;
  }

  /**
   * Parses usageMetadata from a Gemini API response:
   * (promptTokenCount + candidatesTokenCount + thoughtsTokenCount)
   * and calculates real-time USD cost.
   */
  public static parseUsageAndCost(usageMetadata?: GeminiUsageMetadata): TokenUsageRecord {
    const promptTokenCount = Math.max(Number(usageMetadata?.promptTokenCount || 0), 0);
    const candidatesTokenCount = Math.max(Number(usageMetadata?.candidatesTokenCount || 0), 0);
    const thoughtsTokenCount = Math.max(Number(usageMetadata?.thoughtsTokenCount || 0), 0);

    const totalTokens = promptTokenCount + candidatesTokenCount + thoughtsTokenCount;

    // Gemini Flash multimodal pricing (~$0.15 / 1M input tokens, ~$0.60 / 1M output+thought tokens)
    const inputCost = (promptTokenCount / 1_000_000) * 0.15;
    const outputCost = ((candidatesTokenCount + thoughtsTokenCount) / 1_000_000) * 0.60;
    const rawCost = inputCost + outputCost;

    // Apply micro-cost floor of $0.000005 if tokens > 0
    const estimatedCostUsd =
      totalTokens > 0 ? Number(Math.max(rawCost, 0.000005).toFixed(6)) : 0;

    return {
      promptTokenCount,
      candidatesTokenCount,
      thoughtsTokenCount,
      totalTokens,
      estimatedCostUsd,
    };
  }

  /**
   * Fetches current ledger state from Supabase PostgreSQL `ai_token_ledger`
   */
  public static async getLedgerStatus(): Promise<LedgerStatus> {
    const maxBudget = this.getMaxBudgetUsd();
    this.localLedger.max_budget_usd = maxBudget;

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from('ai_token_ledger')
          .select('id, total_tokens, estimated_cost_usd, is_paused, updated_at')
          .eq('id', 'global')
          .maybeSingle();

        if (!error && data) {
          const totalTokens = Number(data.total_tokens || 0);
          const estimatedCostUsd = Number(data.estimated_cost_usd || 0);
          const isPaused = Boolean(data.is_paused) || estimatedCostUsd >= maxBudget;

          this.localLedger = {
            id: String(data.id || 'global'),
            total_tokens: Math.max(totalTokens, this.localLedger.total_tokens),
            estimated_cost_usd: Math.max(estimatedCostUsd, this.localLedger.estimated_cost_usd),
            is_paused: isPaused || this.localLedger.is_paused,
            max_budget_usd: maxBudget,
            budget_exceeded:
              isPaused ||
              this.localLedger.is_paused ||
              Math.max(estimatedCostUsd, this.localLedger.estimated_cost_usd) >= maxBudget,
            updated_at: String(data.updated_at || new Date().toISOString()),
          };
        }
      } catch (err) {
        console.warn('[SupabaseTokenLedger] Read fallback to local memory ledger:', err);
      }
    }

    return { ...this.localLedger };
  }

  /**
   * Invokes the Supabase PostgreSQL RPC `record_gemini_tokens(tokens_to_add, cost_to_add, max_budget)`
   * to atomically increment the token ledger and return `budget_exceeded BOOLEAN`.
   */
  public static async recordGeminiTokens(
    tokensToAdd: number,
    costToAdd: number,
    maxBudgetUsd?: number
  ): Promise<{ budgetExceeded: boolean; ledger: LedgerStatus }> {
    const maxBudget = maxBudgetUsd ?? this.getMaxBudgetUsd();
    const safeTokens = Math.max(Math.round(tokensToAdd || 0), 0);
    const safeCost = Math.max(Number(costToAdd || 0), 0);

    // Update local mirror first
    this.localLedger.total_tokens += safeTokens;
    this.localLedger.estimated_cost_usd = Number(
      (this.localLedger.estimated_cost_usd + safeCost).toFixed(6)
    );
    this.localLedger.max_budget_usd = maxBudget;
    this.localLedger.updated_at = new Date().toISOString();

    if (this.localLedger.estimated_cost_usd >= maxBudget) {
      this.localLedger.is_paused = true;
      this.localLedger.budget_exceeded = true;
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data: rpcBudgetExceeded, error: rpcError } = await client.rpc(
          'record_gemini_tokens',
          {
            tokens_to_add: safeTokens,
            cost_to_add: safeCost,
            max_budget: maxBudget,
          }
        );

        if (!rpcError && typeof rpcBudgetExceeded === 'boolean') {
          if (rpcBudgetExceeded) {
            this.localLedger.is_paused = true;
            this.localLedger.budget_exceeded = true;
          }
          // Refresh canonical row values
          await this.getLedgerStatus();
        } else if (rpcError) {
          console.warn(
            '[SupabaseTokenLedger] RPC record_gemini_tokens warning (using local mirror):',
            rpcError.message
          );
        }
      } catch (err) {
        console.warn('[SupabaseTokenLedger] RPC invocation error (using local mirror):', err);
      }
    }

    const budgetExceeded =
      this.localLedger.is_paused ||
      this.localLedger.budget_exceeded ||
      this.localLedger.estimated_cost_usd >= maxBudget;

    return {
      budgetExceeded,
      ledger: { ...this.localLedger, budget_exceeded: budgetExceeded },
    };
  }
}

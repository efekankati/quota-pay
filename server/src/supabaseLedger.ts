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
  // Local atomic mirror synced asynchronously with Supabase PostgreSQL `ai_token_ledger`
  private static localLedger: LedgerStatus = {
    id: 'global',
    total_tokens: 0,
    estimated_cost_usd: 0,
    is_paused: false,
    max_budget_usd: Number(process.env.AI_MAX_BUDGET_USD || 5.0),
    budget_exceeded: false,
    updated_at: new Date().toISOString(),
  };

  private static lastCloudSyncMs = 0;

  public static getMaxBudgetUsd(): number {
    const val = Number(process.env.AI_MAX_BUDGET_USD || 5.0);
    return Number.isFinite(val) && val > 0 ? val : 5.0;
  }

  private static getSupabaseConfig(): { url: string; key: string } | null {
    const rawUrl = (
      process.env.SUPABASE_URL ||
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      'https://nnamvsnorjbsruwhkker.supabase.co'
    ).trim();
    const url = (rawUrl.includes('supbase.com')
      ? rawUrl.replace('supbase.com', 'supabase.co')
      : rawUrl
    ).replace(/\/+$/, '');

    const key = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      ''
    ).trim();

    if (!url || !key) return null;
    return { url, key };
  }

  /**
   * 0ms synchronous check of the soft-cap ledger mirror (triggers background refresh if >10s old)
   */
  public static getLedgerStatusFast(): LedgerStatus {
    const maxBudget = this.getMaxBudgetUsd();
    this.localLedger.max_budget_usd = maxBudget;
    this.localLedger.budget_exceeded =
      this.localLedger.is_paused || this.localLedger.estimated_cost_usd >= maxBudget;

    if (Date.now() - this.lastCloudSyncMs > 10_000) {
      this.lastCloudSyncMs = Date.now();
      this.getLedgerStatus().catch(() => {});
    }

    return { ...this.localLedger };
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

    const inputCost = (promptTokenCount / 1_000_000) * 0.15;
    const outputCost = ((candidatesTokenCount + thoughtsTokenCount) / 1_000_000) * 0.60;
    const rawCost = inputCost + outputCost;

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
   * Fetches current ledger state from Supabase PostgreSQL `ai_token_ledger` via direct REST API
   * (compatible with all Node.js versions without requiring a WebSocket polyfill).
   */
  public static async getLedgerStatus(): Promise<LedgerStatus> {
    const maxBudget = this.getMaxBudgetUsd();
    this.localLedger.max_budget_usd = maxBudget;
    this.lastCloudSyncMs = Date.now();

    const cfg = this.getSupabaseConfig();
    if (cfg) {
      try {
        const res = await fetch(
          `${cfg.url}/rest/v1/ai_token_ledger?id=eq.global&select=id,total_tokens,estimated_cost_usd,is_paused,updated_at`,
          {
            method: 'GET',
            headers: {
              apikey: cfg.key,
              Authorization: `Bearer ${cfg.key}`,
              Accept: 'application/json',
            },
          }
        );

        if (res.ok) {
          const rows: any = await res.json();
          const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          if (data) {
            const totalTokens = Number(data.total_tokens || 0);
            const estimatedCostUsd = Number(data.estimated_cost_usd || 0);
            const isPaused = Boolean(data.is_paused) || estimatedCostUsd >= maxBudget;

            this.localLedger = {
              id: String(data.id || 'global'),
              total_tokens: Math.max(totalTokens, this.localLedger.total_tokens),
              estimated_cost_usd: Math.max(
                estimatedCostUsd,
                this.localLedger.estimated_cost_usd
              ),
              is_paused: isPaused || this.localLedger.is_paused,
              max_budget_usd: maxBudget,
              budget_exceeded:
                isPaused ||
                this.localLedger.is_paused ||
                Math.max(estimatedCostUsd, this.localLedger.estimated_cost_usd) >= maxBudget,
              updated_at: String(data.updated_at || new Date().toISOString()),
            };
          }
        }
      } catch {
        // Fallback to local memory ledger
      }
    }

    return { ...this.localLedger };
  }

  /**
   * Atomically updates local memory mirror in 0ms and invokes the Supabase RPC
   * `record_gemini_tokens(tokens_to_add, cost_to_add, max_budget)`.
   */
  public static async recordGeminiTokens(
    tokensToAdd: number,
    costToAdd: number,
    maxBudgetUsd?: number
  ): Promise<{ budgetExceeded: boolean; ledger: LedgerStatus }> {
    const maxBudget = maxBudgetUsd ?? this.getMaxBudgetUsd();
    const safeTokens = Math.max(Math.round(tokensToAdd || 0), 0);
    const safeCost = Math.max(Number(costToAdd || 0), 0);

    // 1. Immediate 0ms atomic update in memory
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

    const budgetExceeded =
      this.localLedger.is_paused ||
      this.localLedger.budget_exceeded ||
      this.localLedger.estimated_cost_usd >= maxBudget;

    // 2. Non-blocking cloud RPC sync so `/api/ai/parse-receipt` returns to the phone with 0ms DB wait
    const cfg = this.getSupabaseConfig();
    if (cfg) {
      fetch(`${cfg.url}/rest/v1/rpc/record_gemini_tokens`, {
        method: 'POST',
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tokens_to_add: safeTokens,
          cost_to_add: safeCost,
          max_budget: maxBudget,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            const rpcBudgetExceeded = await res.json();
            if (rpcBudgetExceeded === true) {
              this.localLedger.is_paused = true;
              this.localLedger.budget_exceeded = true;
            }
          }
        })
        .catch(() => {});
    }

    return {
      budgetExceeded,
      ledger: { ...this.localLedger, budget_exceeded: budgetExceeded },
    };
  }
}

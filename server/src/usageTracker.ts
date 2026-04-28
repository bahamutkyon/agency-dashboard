/**
 * Aggregates usage events from the claude CLI into the SQLite store.
 * Workspace-agnostic — your subscription quota is global.
 */
import { recordUsageTurn, recordRateLimitState, getUsageSummary } from "./store.js";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

class UsageTracker {
  recordTurn(result: any) {
    const cost = Number(result.total_cost_usd || 0);
    const u = result.usage || {};
    recordUsageTurn(todayStr(), {
      costUSD: cost,
      inputTokens: Number(u.input_tokens || 0),
      outputTokens: Number(u.output_tokens || 0),
      cacheCreationTokens: Number(u.cache_creation_input_tokens || 0),
      cacheReadTokens: Number(u.cache_read_input_tokens || 0),
      turns: 1,
    });
  }

  recordRateLimit(evt: any) {
    const info = evt.rate_limit_info;
    if (!info) return;
    recordRateLimitState({
      status: String(info.status || ""),
      rateLimitType: String(info.rateLimitType || ""),
      resetsAt: Number(info.resetsAt || 0),
    });
  }

  summary() {
    return getUsageSummary();
  }
}

export const usageTracker = new UsageTracker();

/**
 * Aggregates usage events from the claude CLI into the SQLite store.
 * Workspace-agnostic — your subscription quota is global.
 */
import { recordUsageTurn, recordRateLimitState, getUsageSummary } from "./store.js";
import { setOneShotUsageRecorder } from "./claudeOneShot.js";

function todayStr(): string {
  // Use local date (sv-SE locale produces YYYY-MM-DD) so UTC+8 users don't
  // have usage before 08:00 counted toward the previous day.
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

class UsageTracker {
  /**
   * 記錄一輪用量。
   * @param result  Claude CLI `--output-format json` 的頂層物件（含 total_cost_usd / usage）。
   * @param source  成本歸因標籤；預設 "interactive"，與 agentManager 既有呼叫相容。
   */
  recordTurn(result: any, source = "interactive") {
    const cost = Number(result.total_cost_usd || 0);
    const u = result.usage || {};
    recordUsageTurn(todayStr(), {
      costUSD: cost,
      inputTokens: Number(u.input_tokens || 0),
      outputTokens: Number(u.output_tokens || 0),
      cacheCreationTokens: Number(u.cache_creation_input_tokens || 0),
      cacheReadTokens: Number(u.cache_read_input_tokens || 0),
      turns: 1,
    }, source);
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

// 接線：把 recordTurn 注入 claudeOneShot 的 recorder，讓 runClaudeOneShot 的呼叫端
// 只需傳 source 選項即可自動記用量，而不需直接 import usageTracker（避免循環依賴）。
setOneShotUsageRecorder((result, source) => usageTracker.recordTurn(result, source));

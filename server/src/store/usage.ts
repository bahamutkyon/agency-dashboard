import { db } from "../db.js";
import type { DailyEntry } from "./types.js";

function rowToDaily(r: any): DailyEntry {
  return {
    date: r.date,
    costUSD: r.cost_usd,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    turns: r.turns,
  };
}

/**
 * 雙寫：總帳 usage_daily（原邏輯不變）+ 來源維度 usage_daily_source。
 * source 預設 "interactive"，與 agentManager 的既有呼叫相容。
 */
export function recordUsageTurn(
  date: string,
  deltas: Partial<Omit<DailyEntry, "date">>,
  source = "interactive",
) {
  // 1. 總帳 usage_daily（原邏輯不變）
  const cur = db.prepare("SELECT * FROM usage_daily WHERE date = ?").get(date) as any;
  if (cur) {
    db.prepare(`
      UPDATE usage_daily SET
        cost_usd = cost_usd + ?,
        input_tokens = input_tokens + ?,
        output_tokens = output_tokens + ?,
        cache_creation_tokens = cache_creation_tokens + ?,
        cache_read_tokens = cache_read_tokens + ?,
        turns = turns + ?
      WHERE date = ?
    `).run(
      deltas.costUSD || 0, deltas.inputTokens || 0, deltas.outputTokens || 0,
      deltas.cacheCreationTokens || 0, deltas.cacheReadTokens || 0, deltas.turns || 1,
      date,
    );
  } else {
    db.prepare(`
      INSERT INTO usage_daily (date, cost_usd, input_tokens, output_tokens,
                                cache_creation_tokens, cache_read_tokens, turns)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      date, deltas.costUSD || 0, deltas.inputTokens || 0, deltas.outputTokens || 0,
      deltas.cacheCreationTokens || 0, deltas.cacheReadTokens || 0, deltas.turns || 1,
    );
  }
  // 2. 來源維度 usage_daily_source（UPSERT 累加）
  db.prepare(`
    INSERT INTO usage_daily_source
      (date, source, cost_usd, input_tokens, output_tokens,
       cache_creation_tokens, cache_read_tokens, turns)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET
      cost_usd = cost_usd + excluded.cost_usd,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
      cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
      turns = turns + excluded.turns
  `).run(
    date, source,
    deltas.costUSD || 0, deltas.inputTokens || 0, deltas.outputTokens || 0,
    deltas.cacheCreationTokens || 0, deltas.cacheReadTokens || 0, deltas.turns || 1,
  );
}

/** Local YYYY-MM-DD (sv-SE locale trick) — consistent with usageTracker.ts */
function localDateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE").format(d);
}

export function getUsageSummary() {
  const today = localDateStr();
  const todayRow = db.prepare("SELECT * FROM usage_daily WHERE date = ?").get(today) as any;
  const totals = db.prepare(`
    SELECT SUM(cost_usd) as cost, SUM(input_tokens) as input, SUM(output_tokens) as output,
           SUM(cache_creation_tokens) as cc, SUM(cache_read_tokens) as cr, SUM(turns) as turns
    FROM usage_daily
  `).get() as any;
  // Use SQLite localtime modifier so the 7-day window matches local midnight.
  const last7Rows = db.prepare(`
    SELECT * FROM usage_daily WHERE date >= date('now','localtime','-6 days') ORDER BY date ASC
  `).all() as any[];
  const last7Map = new Map<string, DailyEntry>();
  for (const r of last7Rows) last7Map.set(r.date, rowToDaily(r));
  const last7: DailyEntry[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = localDateStr(d);
    last7.push(last7Map.get(k) || {
      date: k, costUSD: 0, inputTokens: 0, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0,
    });
  }
  const rl = db.prepare("SELECT * FROM rate_limit_state WHERE id = 1").get() as any;
  // bySource：今天 + 過去 7 天各 source 的 cost/turns 彙總，供前端顯示成本來源分佈。
  const sourceRows = db.prepare(`
    SELECT source,
           SUM(cost_usd)              AS cost,
           SUM(turns)                 AS turns,
           SUM(input_tokens)          AS input_tokens,
           SUM(output_tokens)         AS output_tokens
    FROM usage_daily_source
    WHERE date >= date('now','localtime','-6 days')
    GROUP BY source
    ORDER BY cost DESC
  `).all() as any[];
  const bySource = sourceRows.map((r) => ({
    source: r.source as string,
    costUSD: r.cost || 0,
    turns: r.turns || 0,
    inputTokens: r.input_tokens || 0,
    outputTokens: r.output_tokens || 0,
  }));
  return {
    today: todayRow ? rowToDaily(todayRow) : { date: today, costUSD: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0 },
    total: {
      costUSD: totals.cost || 0,
      inputTokens: totals.input || 0,
      outputTokens: totals.output || 0,
      cacheCreationTokens: totals.cc || 0,
      cacheReadTokens: totals.cr || 0,
      turns: totals.turns || 0,
    },
    rateLimit: rl ? {
      status: rl.status,
      rateLimitType: rl.rate_limit_type,
      resetsAt: rl.resets_at,
      capturedAt: rl.captured_at,
    } : undefined,
    last7,
    bySource,
  };
}

export function recordRateLimitState(info: { status: string; rateLimitType: string; resetsAt: number }) {
  db.prepare(`
    INSERT OR REPLACE INTO rate_limit_state (id, status, rate_limit_type, resets_at, captured_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(info.status, info.rateLimitType, info.resetsAt, Date.now());
}

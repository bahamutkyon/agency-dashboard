/**
 * models.ts —— 模型分級與 effort 的單一真相來源。
 *
 * 為什麼存在：過去各處把模型版本寫死（claude-haiku-4-5-20251001 / claude-sonnet-4-6 /
 * claude-opus-4-7），新模型（Haiku/Sonnet/Opus 5.5、Fable 5.1）推出後，這些背景任務
 * 仍停在舊版——主對話已經在用 Opus 5.5，標題/蒸餾/研究/能力學習卻還是上一代。
 *
 * 原則：
 * 1. 一律用 Claude Code 的「家族別名」（haiku / sonnet / opus）。別名會隨 CLI 升級指向該家族
 *    最新版，模型換代不必再改程式。需要釘版時用環境變數覆蓋（DASHBOARD_MODEL_*）。
 * 2. Fable 刻意不當任何預設：依 Claude Code 文件，非互動（-p）模式下 Fable 若走 usage credits
 *    計費，CLI「不會詢問就直接扣」。要用請自己設 DASHBOARD_MODEL_DEEP=fable 並確認計費方式。
 * 3. effort：5.5 家族在 Claude Code 的預設是 medium（Opus 4.7 時代 CLI 預設 xhigh）。
 *    品質關鍵、低頻的一次性任務（研究綜整、能力學習）與專案經理（交辦前釐清、收貨驗收）
 *    明確拉到 high，其餘交給模型預設。全部可用環境變數調整，設 "default" 代表不指定。
 */

// 注意：modelFor / *Effort 一律在「呼叫時」解析，不要存成模組層常數——.env.local 由 remoteAccess.ts
// 載入，模組載入順序早於它的常數會讀不到 DASHBOARD_* 覆蓋值。

export type ModelTier = "fast" | "balanced" | "deep";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

type Env = Record<string, string | undefined>;

const TIER_DEFAULTS: Record<ModelTier, string> = {
  fast: "haiku",      // 分類、命名、蒸餾、拆題、看守評估：量大、要快、要便宜
  balanced: "sonnet", // 摘要、整合、帶工具的子題研究：中等複雜度
  deep: "opus",       // 研究綜整、能力學習：品質決定結論，用最強的常規型號
};

const TIER_ENV: Record<ModelTier, string> = {
  fast: "DASHBOARD_MODEL_FAST",
  balanced: "DASHBOARD_MODEL_BALANCED",
  deep: "DASHBOARD_MODEL_DEEP",
};

/** 依分級回傳要給 `claude --model` 的值（別名或完整 model id）。 */
export function modelFor(tier: ModelTier, env: Env = process.env): string {
  const v = env[TIER_ENV[tier]]?.trim();
  return v || TIER_DEFAULTS[tier];
}

const EFFORT_LEVELS: ReadonlySet<string> = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * 解析 effort 設定。回傳 undefined 代表「不指定，交給模型/CLI 預設」。
 * - 未設定 → fallback
 * - "default" / "auto" / "" → undefined（明確要求用模型預設）
 * - 合法等級 → 該等級；非法值 → fallback（打錯字不該讓 spawn 帶入未知參數）
 */
export function parseEffort(raw: string | undefined, fallback?: EffortLevel): EffortLevel | undefined {
  if (raw === undefined) return fallback;
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "default" || s === "auto") return undefined;
  return EFFORT_LEVELS.has(s) ? (s as EffortLevel) : fallback;
}

/** deep 層一次性任務（研究綜整、能力學習）的 effort，預設 high。 */
export function deepEffort(env: Env = process.env): EffortLevel | undefined {
  return parseEffort(env.DASHBOARD_EFFORT_DEEP, "high");
}

/** 專案經理（agents-orchestrator）互動 session 的 effort，預設 high。 */
export function orchestratorEffort(env: Env = process.env): EffortLevel | undefined {
  return parseEffort(env.DASHBOARD_EFFORT_PM, "high");
}

/** 其他一般 agent session 的 effort，預設不指定（用模型預設；Opus 5.5 = medium）。 */
export function agentEffort(env: Env = process.env): EffortLevel | undefined {
  return parseEffort(env.DASHBOARD_EFFORT_AGENT, undefined);
}

export const ORCHESTRATOR_AGENT_ID = "agents-orchestrator";

/** 依 agentId 決定互動 session 的 effort。 */
export function effortForAgent(agentId: string, env: Env = process.env): EffortLevel | undefined {
  return agentId === ORCHESTRATOR_AGENT_ID ? orchestratorEffort(env) : agentEffort(env);
}

/**
 * 用 `--agent` 啟動的同事 session（對話、派工子代理、排程、workflow、每日簡報）要明確指定的模型。
 * 預設 undefined＝不帶 `--model`，
 * 用 Claude Code 的預設模型（Pro/Max/Team/Enterprise 為最新 Opus；但使用者全域設定或
 * ANTHROPIC_MODEL 若釘了舊版，所有同事都會跟著卡在舊版——此時用這兩個變數覆蓋）。
 * - 專案經理（agents-orchestrator）：DASHBOARD_MODEL_PM
 * - 其他所有同事：DASHBOARD_MODEL_AGENT
 * 值可為別名（opus / sonnet / fable）或完整 model id；"default" 或空字串＝不指定。
 */
export function interactiveModelFor(agentId: string, env: Env = process.env): string | undefined {
  const raw = agentId === ORCHESTRATOR_AGENT_ID ? env.DASHBOARD_MODEL_PM : env.DASHBOARD_MODEL_AGENT;
  const v = raw?.trim();
  if (!v || v.toLowerCase() === "default") return undefined;
  return v;
}

/** 轉成 CLI 參數；undefined → 不帶任何參數（保留 CLI 預設行為）。 */
export function effortArgs(level: EffortLevel | undefined): string[] {
  return level ? ["--effort", level] : [];
}

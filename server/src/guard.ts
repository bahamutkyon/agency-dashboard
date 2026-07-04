/**
 * guard.ts — shellward 守衛核心
 *
 * 職責：
 * - 管理單例 ShellwardClient（可注入 fake，供測試）
 * - 判斷 gateMode（shadow / enforce / off）
 * - evaluateGuard(input) → { decision, reason }
 * - 維護 500 筆環形緩衝記錄
 *
 * 決策矩陣（Bash 工具）：
 * | verdict          | enforce                 | shadow           |
 * |------------------|-------------------------|------------------|
 * | available=false  | deny(checker unavailable)| allow + wouldBlock|
 * | safe=false       | deny(reason/ruleId)     | allow + wouldBlock|
 * | safe=true        | allow                   | allow            |
 *
 * 非 Bash 工具：一律 allow，不打 shellward，不記錄。
 * off 模式：一律 allow，不打 shellward（但記錄）。
 */
import crypto from "node:crypto";
import { ShellwardClient } from "./shellwardClient.js";
import type { GuardVerdict } from "./shellwardClient.js";

// ── Token ─────────────────────────────────────────────────────────────────────

/** 模組載入時固定一次；G4 之後塞進 hook 命令驗證。 */
export const GUARD_TOKEN: string = crypto.randomUUID();

// ── Client 注入 ───────────────────────────────────────────────────────────────

type CheckerClient = { checkCommand(command: string): Promise<GuardVerdict> };

/** 單例 — 預設真實 ShellwardClient；測試透過 setShellwardClient() 注入 fake。 */
let _client: CheckerClient = new ShellwardClient();

/**
 * 注入替代 client（供測試，勿在生產程式碼呼叫）。
 * 比照 shellwardClient.ts 設計中的「deps 注入風格」。
 */
export function setShellwardClient(c: CheckerClient): void {
  _client = c;
}

// ── Gate mode ─────────────────────────────────────────────────────────────────

/**
 * 讀取環境變數決定守衛模式。
 * - SHELLWARD_GATE=off → off（完全停用，不打 shellward）
 * - SHELLWARD_GATE_MODE=enforce → enforce（真擋）
 * - 其餘 → shadow（預設，只記錄不擋）
 */
export function gateMode(): "shadow" | "enforce" | "off" {
  if (process.env.SHELLWARD_GATE === "off") return "off";
  if (process.env.SHELLWARD_GATE_MODE === "enforce") return "enforce";
  return "shadow";
}

// ── Ring buffer ───────────────────────────────────────────────────────────────

export interface GuardDecisionEntry {
  ts: number;
  /** 工具名稱，例如 "Bash" */
  tool: string;
  /** 指令摘要（截斷至 200 字元） */
  commandSummary: string;
  /** shellward 回傳的 verdict（off 模式 / 非 Bash 為 null） */
  verdict: GuardVerdict | null;
  /** 最終決策 */
  decision: "allow" | "deny";
  mode: "shadow" | "enforce" | "off";
  sessionId?: string;
  /** shadow 模式下「若在 enforce 會擋」的標記 */
  wouldBlock: boolean;
}

const RING_SIZE = 500;
const _decisions: GuardDecisionEntry[] = [];

export function recordGuardDecision(entry: GuardDecisionEntry): void {
  _decisions.push(entry);
  if (_decisions.length > RING_SIZE) {
    _decisions.shift();
  }
}

export function listGuardDecisions(limit = 100): GuardDecisionEntry[] {
  const n = Math.min(limit, _decisions.length);
  return _decisions.slice(_decisions.length - n);
}

// ── Core evaluation ───────────────────────────────────────────────────────────

export interface GuardInput {
  tool_name: string;
  tool_input?: Record<string, unknown> & { command?: string };
  sessionId?: string;
}

/**
 * 評估一個工具呼叫是否應允許執行。
 *
 * @param input        工具呼叫的描述（tool_name、tool_input、sessionId）
 * @param overrideMode 可選的模式覆蓋（用於測試，避免依賴 process.env）
 * @returns            { decision: "allow"|"deny", reason? }
 */
export async function evaluateGuard(
  input: GuardInput,
  overrideMode?: "shadow" | "enforce" | "off",
): Promise<{ decision: "allow" | "deny"; reason?: string }> {
  // 非 Bash：一律放行，不記錄，不打 shellward
  if (input.tool_name !== "Bash") {
    return { decision: "allow" };
  }

  const mode = overrideMode ?? gateMode();
  const command = input.tool_input?.command ?? "";
  const commandSummary = command.slice(0, 200);

  // off 模式：放行但記錄（方便稽核）
  if (mode === "off") {
    recordGuardDecision({
      ts: Date.now(),
      tool: input.tool_name,
      commandSummary,
      verdict: null,
      decision: "allow",
      mode,
      sessionId: input.sessionId,
      wouldBlock: false,
    });
    return { decision: "allow" };
  }

  // 呼叫 shellward 檢查
  const verdict = await _client.checkCommand(command);

  let decision: "allow" | "deny";
  let reason: string | undefined;
  let wouldBlock = false;

  if (!verdict.available) {
    // checker 不可用 → fail-closed（enforce deny；shadow allow + 標記）
    if (mode === "enforce") {
      decision = "deny";
      reason = "checker unavailable";
    } else {
      decision = "allow";
      wouldBlock = true;
    }
  } else if (!verdict.safe) {
    // 危險指令 → enforce deny；shadow allow + 標記
    if (mode === "enforce") {
      decision = "deny";
      reason = verdict.reason ?? verdict.ruleId ?? "unsafe command";
    } else {
      decision = "allow";
      wouldBlock = true;
    }
  } else {
    // 安全 → 一律放行
    decision = "allow";
    wouldBlock = false;
  }

  recordGuardDecision({
    ts: Date.now(),
    tool: input.tool_name,
    commandSummary,
    verdict,
    decision,
    mode,
    sessionId: input.sessionId,
    wouldBlock,
  });

  return decision === "deny"
    ? { decision: "deny", reason }
    : { decision: "allow" };
}

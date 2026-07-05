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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ShellwardClient } from "./shellwardClient.js";
import type { GuardVerdict } from "./shellwardClient.js";

// ── Token ─────────────────────────────────────────────────────────────────────

/**
 * 預設 token 檔路徑（與 guardSettings 的 GUARD_SETTINGS_DIR 同目錄）。
 * 不 import guardSettings 以避免循環相依。
 */
const DEFAULT_TOKEN_PATH = path.join(os.tmpdir(), "agency-dashboard-guard", "token");

/**
 * 載入或建立持久化 guard token。
 *
 * - token 檔存在且非空 → 讀回並回傳（跨重啟穩定）
 * - 不存在或空白 → 生成 UUID，確保目錄存在，寫檔後回傳
 * - 讀檔失敗 → 當作不存在，重新生成
 * - 寫檔/建目錄失敗 → 記錄 warn，回傳記憶體 token（degrade，絕不 throw）
 *
 * @param tokenPath 可注入自訂路徑（供測試隔離）；預設用 DEFAULT_TOKEN_PATH
 */
export function loadOrCreateToken(tokenPath = DEFAULT_TOKEN_PATH): string {
  // 嘗試讀回既有 token
  try {
    if (fs.existsSync(tokenPath)) {
      const content = fs.readFileSync(tokenPath, "utf8").trim();
      if (content) return content;
    }
  } catch {
    // 讀失敗：當作不存在，往下重新生成
  }

  // 生成新 token
  const token = crypto.randomUUID();

  // 嘗試持久化；失敗降級（不 throw）
  try {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, token, { encoding: "utf8" });
  } catch (e) {
    console.warn("[guard] failed to persist token to", tokenPath, "—", (e as Error).message);
    // 降級：回傳記憶體 token（與改前行為相同）
  }

  return token;
}

/** 模組載入時固定一次；寫進 hook 命令用於驗證。跨重啟穩定。 */
export const GUARD_TOKEN: string = loadOrCreateToken();

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

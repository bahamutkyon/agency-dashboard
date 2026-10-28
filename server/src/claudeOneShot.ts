/**
 * runClaudeOneShot —— 一次性非互動呼叫 Claude CLI 的共用底層。
 *
 * 起因：多處（summarize / merge / 蒸餾 / 自動命名）各自 spawnClaude 開一次性子程序，
 * 但都沒掛 `child.on("error")`。spawn 失敗（ENOENT / PATH 漂移）時，ChildProcess 的
 * error 是 EventEmitter 的 error 事件，未處理 → uncaught exception 讓整台 server 崩潰。
 * 而且多半沒逾時，claude 卡住時 HTTP 永不回、子程序洩漏。
 *
 * 本函式把「掛 error handler + 預設逾時 + stdout 上限」統一收在一處，且**不 throw**：
 * spawn 失敗 / 逾時 / 非零離開碼一律以 resolve 回 `{ ok:false, error }`，呼叫端只需判斷 ok。
 *
 * spawn 函式可注入（預設 spawnClaude），對齊 dispatchRunner 的 deps 注入風格以利測試。
 */
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawnClaude } from "./claudeProcess.js";
import { sanitizedChildEnv } from "./childEnv.js";
import { noteClaudeResult, noteClaudeFailureText } from "./claudeHealth.js";

export type SpawnClaudeFn = (args: string[], options?: Partial<SpawnOptions>) => ChildProcess;

// ── 可注入的用量記錄器（避免直接 import usageTracker 產生循環依賴）──────────────
export type OneShotUsageRecorder = (result: any, source: string) => void;
let _oneShotRecorder: OneShotUsageRecorder | undefined;

/**
 * 登記一個回呼，在每次 code===0 且帶 source 的成功呼叫後被觸發（fail-safe，永不拋）。
 * 由 usageTracker.ts 在模組初始化時呼叫一次，把自己的 recordTurn 接進來。
 */
export function setOneShotUsageRecorder(fn: OneShotUsageRecorder): void {
  _oneShotRecorder = fn;
}

/**
 * Fail-safe：呼叫已登記的 recorder。任何錯誤均吞掉。
 * 供 capabilityLearning.ts 等自己管 spawn 但需要記用量的呼叫端使用。
 */
export function recordOneShotUsage(result: any, source: string): void {
  if (!_oneShotRecorder) return;
  try { _oneShotRecorder(result, source); } catch {}
}
// ─────────────────────────────────────────────────────────────────────────────

export interface RunClaudeOneShotOpts {
  /** 硬逾時（毫秒）。逾時會 kill 子程序並回 ok:false。預設 180000（3 分鐘）。 */
  timeoutMs?: number;
  /** 寫進子程序 stdin 的內容（通常是 prompt）。 */
  input?: string;
  /** 可注入的 spawn 函式（測試用假的）；預設 spawnClaude。 */
  spawn?: SpawnClaudeFn;
  /**
   * 成本歸因標籤（如 "titler" / "summarize" / "merge" / "research" / "distill"）。
   * 設定後在 code===0 成功路徑 fail-safe 嘗試解析 JSON 並觸發已登記的 usageRecorder，
   * 讓 UsageBar 可以顯示各功能的用量佔比。不設定則不記錄（不影響既有行為）。
   */
  source?: string;
}

export interface RunClaudeOneShotResult {
  ok: boolean;
  /** 收集到的 stdout（即使失敗也回傳已收到的部分，方便診斷）。 */
  stdout: string;
  /** 失敗原因（spawn 失敗 / 逾時 / 非零離開碼 / 輸出超限）。ok 時為 undefined。 */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_STDOUT_BYTES = 5_000_000;

/** 把 `-p --output-format json` 的 stdout 解析成物件；不是單一 JSON 物件（如 stream-json）回 null。 */
export function parseResultJson(stdout: string): any | null {
  const t = stdout.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 非零離開碼時組一個「看得懂原因」的錯誤字串。
 * 起因：CLI 失敗時真正原因常在 stdout 的 JSON result（例如「Failed to authenticate…」），
 * 舊版只取 stderr，各處只看到「claude exit 1」，登入過期整整 7 週沒人看得出來。
 */
export function describeOneShotFailure(code: number | null, stderr: string, parsed: any | null): string {
  const resultText = parsed && parsed.is_error && typeof parsed.result === "string" ? parsed.result.trim() : "";
  const detail = resultText || stderr.trim();
  return detail ? `claude 失敗（離開碼 ${code}）：${detail.slice(0, 500)}` : `claude 離開碼 ${code}`;
}

/**
 * 一次性跑 claude，回傳 { ok, stdout, error }。永不 throw、永不讓 error 事件外洩。
 */
export function runClaudeOneShot(
  args: string[],
  opts: RunClaudeOneShotOpts = {},
): Promise<RunClaudeOneShotResult> {
  const spawn = opts.spawn ?? spawnClaude;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<RunClaudeOneShotResult>((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: RunClaudeOneShotResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawn(args, { env: sanitizedChildEnv() });
    } catch (e: any) {
      // 極少數 spawn 同步 throw（例如參數錯誤）也要接住，不外洩。
      finish({ ok: false, stdout: "", error: e?.message || String(e) });
      return;
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish({ ok: false, stdout: out, error: `claude 逾時（${timeoutMs}ms）` });
      }, timeoutMs);
      timer.unref?.();
    }

    // 關鍵：掛 error handler。spawn 失敗（ENOENT / PATH 漂移）時 error 事件在此收尾，
    // 而非變成 uncaught exception 讓 server 崩潰。
    child.on("error", (e: Error) => {
      finish({ ok: false, stdout: out, error: e?.message || String(e) });
    });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d) => {
      out += String(d);
      if (out.length > MAX_STDOUT_BYTES) {
        try { child.kill(); } catch {}
        finish({ ok: false, stdout: out, error: "輸出超過上限" });
      }
    });
    child.stderr?.on("data", (d) => { err += String(d); });

    // stdin 也可能在 spawn 失敗時噴 EPIPE；吞掉避免變成 uncaught。
    child.stdin?.on?.("error", () => {});
    try {
      if (opts.input != null) child.stdin?.write(Buffer.from(opts.input, "utf8"));
      child.stdin?.end();
    } catch {
      // spawn 失敗導致 stdin 不可寫；交由 error 事件收尾。
    }

    child.on("close", (code) => {
      const parsed = parseResultJson(out);
      // 登入健康度判讀（fail-safe）：成功 → ok；明確的登入錯誤 → auth_failed；其他錯誤不動狀態。
      try {
        if (parsed) noteClaudeResult(parsed);
        else if (code !== 0) noteClaudeFailureText(`${err}\n${out}`);
      } catch {}
      if (code === 0) {
        // Fail-safe 成本歸因記錄：解析 JSON 失敗或 recorder 未登記不影響回傳。
        if (opts.source && parsed) recordOneShotUsage(parsed, opts.source);
        finish({ ok: true, stdout: out });
      } else {
        finish({ ok: false, stdout: out, error: describeOneShotFailure(code, err, parsed) });
      }
    });
  });
}

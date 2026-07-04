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

export type SpawnClaudeFn = (args: string[], options?: Partial<SpawnOptions>) => ChildProcess;

export interface RunClaudeOneShotOpts {
  /** 硬逾時（毫秒）。逾時會 kill 子程序並回 ok:false。預設 180000（3 分鐘）。 */
  timeoutMs?: number;
  /** 寫進子程序 stdin 的內容（通常是 prompt）。 */
  input?: string;
  /** 可注入的 spawn 函式（測試用假的）；預設 spawnClaude。 */
  spawn?: SpawnClaudeFn;
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
      child = spawn(args);
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
      if (code === 0) {
        finish({ ok: true, stdout: out });
      } else {
        finish({ ok: false, stdout: out, error: err.trim() || `claude 離開碼 ${code}` });
      }
    });
  });
}

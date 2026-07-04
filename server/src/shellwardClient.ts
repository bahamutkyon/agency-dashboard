/**
 * ShellwardClient —— 一條常駐的 shellward-mcp stdio JSON-RPC 連線，供 server 端做危險指令檢查。
 *
 * shellward 是 stdio MCP server（JSON-RPC 2.0 over stdio，newline-delimited，每則訊息一行）。
 * 握手：送 initialize → 收 result → 送 notification notifications/initialized → 之後可 tools/call。
 * 檢查指令用 tools/call { name:"check_command", arguments:{ command } }，
 * 回傳在 result.content[0].text 裝一段 JSON 字串：
 *   危險：{ "safe": false, "level": "CRITICAL", "reason": "...", "rule_id": "rm_rf_root" }
 *   安全：{ "safe": true,  "level": null, "reason": null, "rule_id": null }
 *
 * 這是安全鏈的檢查核心，正確性 > 一切。核心不變量：
 * - 常駐重用：spawn 一次、握手一次，後續 tools/call 重用同連線。
 * - 每次呼叫有逾時（預設 5s），逾時 → resolve { available:false, reason:"timeout" }，絕不吊死。
 * - 子程序 error/exit/close → 標記死亡、把所有 pending 收斂為 unavailable；下次呼叫自動重連。
 * - shellward 沒裝 / spawn 一直失敗 → checkCommand 一律回 { available:false }，呼叫端據此 fail-closed。
 * - 絕不 throw、絕不 crash server（所有 child 事件都有 handler，錯誤都以 resolve 收尾）。
 *
 * spawn 函式可注入（預設真 spawn shellward-mcp），比照 claudeOneShot / dispatchRunner 的 deps 注入風格，
 * 讓測試用 fake stdio 驗證協議與逾時/斷線重連，不真跑 shellward。
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { sanitizedChildEnv } from "./childEnv.js";

export type GuardVerdict =
  | { available: true; safe: boolean; reason?: string; ruleId?: string }
  | { available: false; reason: string };

/** 可注入的 spawn 函式：收到已合併好的 env，回傳一個 ChildProcess-like。 */
export type SpawnShellwardFn = (options: { env: NodeJS.ProcessEnv }) => ChildProcess;

export interface ShellwardClientOpts {
  /** 可注入的 spawn（測試用假的）；預設真 spawn shellward-mcp。 */
  spawn?: SpawnShellwardFn;
  /** 每次 checkCommand 的逾時（毫秒）。預設 5000。 */
  timeoutMs?: number;
  /** 基底 env（預設 process.env）；會去 ACCESS_TOKEN 再併 SHELLWARD_* 後給子程序。 */
  baseEnv?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const PROTOCOL_VERSION = "2024-11-05";

/** shellward 需要的環境變數（可從 ~/.claude.json 讀，這裡直接用既有預設）。 */
const SHELLWARD_ENV: Record<string, string> = {
  SHELLWARD_MODE: "enforce",
  SHELLWARD_LOCALE: "zh",
  SHELLWARD_THRESHOLD: "60",
};

/** 預設真 spawn：Windows 走 shellward-mcp.cmd（需 shell），其餘平台 shellward-mcp。 */
const defaultSpawn: SpawnShellwardFn = ({ env }) => {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "shellward-mcp.cmd" : "shellward-mcp";
  return nodeSpawn(cmd, [], { env, stdio: ["pipe", "pipe", "pipe"], shell: isWin });
};

interface Pending {
  resolve: (v: GuardVerdict) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ShellwardClient {
  private readonly spawnFn: SpawnShellwardFn;
  private readonly timeoutMs: number;
  private readonly baseEnv: NodeJS.ProcessEnv;

  /** 目前的連線（存活時非 null）。 */
  private child: ChildProcess | null = null;
  /** 握手完成的 promise；null 代表尚未連線。resolve(true)=就緒、resolve(false)=連線失敗。 */
  private ready: Promise<boolean> | null = null;
  /** 已標記死亡（收到 error/exit/close），下次呼叫需重連。 */
  private dead = false;
  /** 遞增的 JSON-RPC id。 */
  private nextId = 1;
  /** id → pending Promise。收到對應 id 的 response 才 resolve。 */
  private readonly pending = new Map<number, Pending>();
  /** stdout 行緩衝。 */
  private buf = "";

  constructor(opts: ShellwardClientOpts = {}) {
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseEnv = opts.baseEnv ?? process.env;
  }

  /**
   * 檢查一條 shell 指令是否危險。永不 throw。
   * shellward 可用 → { available:true, safe, reason?, ruleId? }
   * shellward 不可用（沒裝/spawn 失敗/逾時/斷線） → { available:false, reason }
   */
  async checkCommand(command: string): Promise<GuardVerdict> {
    let ok: boolean;
    try {
      ok = await this.ensureConnected();
    } catch {
      // ensureConnected 本身不該 throw，但保險起見一律 fail-closed。
      return { available: false, reason: "shellward unavailable" };
    }
    if (!ok || !this.child || this.dead) {
      return { available: false, reason: "shellward unavailable" };
    }
    return this.callTool(command);
  }

  /** 主動關閉連線（例如 server 關機）。 */
  dispose(): void {
    this.teardown("disposed", { available: false, reason: "disposed" });
  }

  // ── 連線 / 握手 ────────────────────────────────────────────────

  /** 確保有一條就緒連線；死亡則重連。回傳是否就緒。 */
  private ensureConnected(): Promise<boolean> {
    if (this.dead) {
      // 上一條已死：清乾淨再重連。
      this.child = null;
      this.ready = null;
      this.dead = false;
    }
    if (this.ready) return this.ready;
    this.ready = this.connect();
    return this.ready;
  }

  private connect(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };

      let child: ChildProcess;
      try {
        child = this.spawnFn({ env: this.buildEnv() });
      } catch {
        // 極少數 spawn 同步 throw：視為連線失敗（fail-closed）。
        this.markDead("spawn threw");
        settle(false);
        return;
      }
      this.child = child;

      // 關鍵：掛 error handler。spawn 失敗（ENOENT / PATH 漂移）時 error 事件在此收尾，
      // 而非變成 uncaught exception 讓 server 崩潰。
      child.on("error", () => {
        this.markDead("child error");
        settle(false);
      });
      const onExit = () => {
        this.markDead("child exit/close");
        settle(false); // 若握手還沒完成，視為失敗
      };
      child.on("exit", onExit);
      child.on("close", onExit);

      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on("data", (d: string | Buffer) => this.onStdout(String(d), () => settle(true)));
      // stderr 只是 log（shellward 會印 "Server started"），收掉避免 backpressure。
      child.stderr?.on("data", () => {});
      // stdin 的 EPIPE 吞掉，避免變成 uncaught。
      child.stdin?.on?.("error", () => {});

      // 送 initialize，等其 response 觸發 settle(true)（在 onStdout 內處理）。
      this.initId = this.nextId++;
      this.write({
        jsonrpc: "2.0",
        id: this.initId,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "agency-dashboard", version: "0.1.0" },
        },
      });
    });
  }

  private initId = -1;

  private buildEnv(): NodeJS.ProcessEnv {
    return { ...sanitizedChildEnv(this.baseEnv), ...SHELLWARD_ENV };
  }

  // ── tools/call ─────────────────────────────────────────────────

  private callTool(command: string): Promise<GuardVerdict> {
    return new Promise<GuardVerdict>((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          resolve({ available: false, reason: "timeout" });
        }
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, timer });

      const okWrite = this.write({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "check_command", arguments: { command } },
      });
      if (!okWrite) {
        // 寫入失敗（連線已死）：立即 fail-closed，不必等逾時。
        this.settlePending(id, { available: false, reason: "shellward unavailable" });
      }
    });
  }

  private settlePending(id: number, v: GuardVerdict): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(v);
  }

  // ── stdout 解析 ────────────────────────────────────────────────

  private onStdout(chunk: string, onInitialized: () => void): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      this.handleMessage(msg, onInitialized);
    }
  }

  private handleMessage(msg: any, onInitialized: () => void): void {
    if (msg == null || typeof msg !== "object") return;
    // initialize 的 response：完成握手 → 送 notifications/initialized → 標記就緒。
    if (msg.id === this.initId && msg.result && msg.result.protocolVersion !== undefined) {
      this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
      onInitialized();
      return;
    }
    // tools/call 的 response（成功或 JSON-RPC error）。
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      this.settlePending(msg.id, parseVerdict(msg));
    }
  }

  private write(obj: unknown): boolean {
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed) return false;
    try {
      return child.stdin.write(JSON.stringify(obj) + "\n");
    } catch {
      return false;
    }
  }

  // ── 死亡 / 收斂 ─────────────────────────────────────────────────

  private markDead(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    // 把所有 pending 收斂為 unavailable（不吊死、不外洩）。
    this.rejectAllPending({ available: false, reason: `shellward unavailable (${reason})` });
  }

  private teardown(reason: string, v: GuardVerdict): void {
    this.dead = true;
    this.rejectAllPending(v);
    try { this.child?.kill(); } catch { /* ignore */ }
    this.child = null;
    this.ready = null;
  }

  private rejectAllPending(v: GuardVerdict): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(v);
      this.pending.delete(id);
    }
  }
}

/**
 * 從 tools/call 的 response 解出 GuardVerdict。
 * shellward 慣例：result.content[0].text 是一段 JSON 字串 { safe, level, reason, rule_id }。
 * 也容錯 structuredContent / result 直接就是物件的情況。
 * 解不出 → fail-closed（available:false）。
 */
function parseVerdict(msg: any): GuardVerdict {
  if (msg?.error) {
    return { available: false, reason: `shellward error: ${msg.error?.message ?? "unknown"}` };
  }
  const result = msg?.result;
  if (!result) return { available: false, reason: "shellward: empty result" };

  let payload: any = result.structuredContent;
  if (payload == null) {
    const text = result?.content?.[0]?.text;
    if (typeof text === "string") {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
  }
  // 少數實作可能把 verdict 直接放 result 頂層。
  if (payload == null && typeof result.safe === "boolean") payload = result;

  if (payload == null || typeof payload.safe !== "boolean") {
    return { available: false, reason: "shellward: unparseable verdict" };
  }
  const reason = payload.reason;
  const ruleId = payload.rule_id ?? payload.ruleId;
  return {
    available: true,
    safe: payload.safe,
    ...(reason != null ? { reason: String(reason) } : {}),
    ...(ruleId != null ? { ruleId: String(ruleId) } : {}),
  };
}

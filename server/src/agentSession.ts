import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { spawnClaude } from "./claudeProcess.js";
import { getGuardSettingsPath } from "./guardSettings.js";
import { spawnCodexTurn, parseCodexLine } from "./codexProcess.js";
import { spawnGeminiTurn, parseGeminiLine } from "./geminiProcess.js";
import { sanitizedChildEnv } from "./childEnv.js";

/**
 * Claude CLI 的 --append-system-prompt 走命令列 arg，Windows CreateProcessW
 * 對單一 arg 上限約 32767 字元。PM session 的 system prompt 含 213 agent
 * catalog (~42KB) 加上 craft / category memory 注入會撞線 → ENAMETOOLONG。
 *
 * 解法：寫到 %TEMP%/agency-dashboard-prompts/<sessionId>.md，args 改用
 * --append-system-prompt-file 接路徑，徹底繞過 arg 上限。
 */
export const PROMPT_TMP_DIR = path.join(os.tmpdir(), "agency-dashboard-prompts");
function ensurePromptTmpDir() {
  if (!fs.existsSync(PROMPT_TMP_DIR)) fs.mkdirSync(PROMPT_TMP_DIR, { recursive: true });
}
/** 啟動時清掉前一個 server 留下的孤兒檔（process crash 沒走 cleanup）。 */
export function cleanupOrphanPromptFiles() {
  try {
    if (!fs.existsSync(PROMPT_TMP_DIR)) return;
    const files = fs.readdirSync(PROMPT_TMP_DIR);
    for (const f of files) {
      try { fs.unlinkSync(path.join(PROMPT_TMP_DIR, f)); } catch {}
    }
    if (files.length) console.log(`[agentSession] cleaned ${files.length} orphan prompt files`);
  } catch (e: any) {
    console.warn("[agentSession] orphan cleanup failed:", e?.message);
  }
}

export type Provider = "claude" | "codex" | "gemini";
export type SessionStatus = "idle" | "starting" | "busy" | "error" | "closed";

/** send() 的結果：
 *  - "sent"     ：session 空閒，已立即送出（觸發本回合）
 *  - "queued"   ：session 忙碌，已排入佇列，回到 idle 時會自動抽出送達（不再丟棄）
 *  - "rejected" ：佇列已滿（異常保護），本則未排入、未送出
 */
export type SendResult = "sent" | "queued" | "rejected";

export interface SessionEvent {
  type: "delta" | "message" | "status" | "error" | "result" | "tool_call" | "tool_result";
  /** 這個事件屬於哪一回合（send 配的 turnId）。等待端據此只認自己的 result，
   *  修「同一 session 多寫入者回覆張冠李戴」。舊事件/未接線路徑可能為 undefined。 */
  turnId?: number;
  payload: any;
}

/**
 * 等待端 turn 比對閘門。核心不變量：只有「雙方都帶 turnId 且不同」時才排除；
 * 任一方缺 turnId（相容舊呼叫端或舊事件）一律全收，避免相容破壞。
 *
 * 這是修 bug 的核心：waiter 只在 turnMatches(我的 turnId, evt.turnId) 為 true 時才 settle，
 * 別的寫入者那一回合的 result（turnId 不同）不會誤觸發本 waiter。
 */
export function turnMatches(myTurnId: number | undefined, evtTurnId: number | undefined): boolean {
  if (myTurnId === undefined || evtTurnId === undefined) return true;
  return myTurnId === evtTurnId;
}

/** 佇列項：文字 + 該則在 send 時就配好的 turnId（drain 時成為當前回合 turnId）。 */
interface QueuedMessage {
  text: string;
  turnId: number;
}

interface SpawnOpts {
  cwd?: string;
}

/**
 * AgentSession abstracts over multiple AI provider CLIs.
 *
 * Two backends with very different process models:
 *  - Claude: a single persistent child process per session, talks via
 *    stream-json on stdin/stdout. Streams deltas in real time.
 *  - Codex: a fresh `codex exec` process per turn, JSONL output. No
 *    streaming deltas, but full message arrives as `item.completed`.
 *
 * The class exposes a uniform event stream (delta / message / status /
 * result / error) so the rest of the system doesn't need to care.
 */
export class AgentSession extends EventEmitter {
  readonly id: string;
  readonly agentId: string;
  readonly provider: Provider;
  readonly extraSystemPrompt?: string;
  /** MCP config can be refreshed mid-session by manager when workspace
   *  enabledMcps change — read at every spawnClaudeChild call. */
  mcpConfigJson?: string;
  status: SessionStatus = "idle";
  /** 最後活動時間（毫秒 epoch）。send() 與 result 事件時更新。
   *  供 agentManager 判斷 idle 子程序是否超過 TTL 而需回收。 */
  lastActivityAt: number = Date.now();

  /** 工作區工作目錄（沙箱）。spawn 時作為 child 的 cwd；未設則回退 process.cwd()。 */
  private cwd?: string;

  /**
   * 忙碌時進來的訊息佇列（FIFO）。舊行為是 busy 就 emit error 並「丟棄」該訊息，
   * 造成「DB 歷史有這句、模型沒收到」的永久不一致（尤其派工回報 EXEC_REPORT
   * 在 PM 忙碌時直接消失、永不轉達）。改為排隊：回到 idle 時抽一則自動送出，
   * 呼叫端不必再關心 busy。
   */
  private queue: QueuedMessage[] = [];
  /** 佇列上限。超過視為異常堆積（呼叫端瘋狂灌訊息），emit error 並拒收溢出，避免失控。 */
  private static readonly MAX_QUEUE = 50;

  /** 單調遞增的 turn 序號產生器。每次 send（sent 或 queued）配一個唯一 turnId。 */
  private nextTurnId = 1;
  /** 當前正在執行（已 dispatch、尚未收到 result）那一回合的 turnId。
   *  result / delta / message 事件都帶這個值，讓等待端只認自己的回合。 */
  private currentTurnId?: number;
  /**
   * 最近一次 send 配到的 turnId，供呼叫端（agentManager.send）同步讀取後透傳給等待端。
   * send 為同步方法，呼叫端在 send() 回傳後立即讀取即可，無交錯風險。
   * rejected（佇列爆滿、未排入）時為 undefined（該則沒有對應回合）。
   */
  lastTurnId?: number;

  // Claude-specific state
  claudeSessionId?: string;
  private child?: ChildProcess;
  private buf = "";
  /** Claude `--append-system-prompt-file` 用的暫存檔路徑（session 級，可重用）。 */
  private promptFilePath?: string;
  /** stop() 主動殺掉的那個 child 引用。close handler 見到時判定為刻意停止，
   *  不覆蓋 setStatus("closed") 為 "error"（idle TTL 回收誤報 error 的根因）。 */
  private stoppingChild?: ChildProcess;

  // Codex-specific state
  codexThreadId?: string;
  private codexBuf = "";
  private codexCurrent = "";
  /** True once we have already emitted a "message" event in this codex turn. */
  private codexEmitted = false;

  // Gemini-specific state — we manage history ourselves since gemini-cli's
  // multi-turn support is patchy. Keep the running transcript so subsequent
  // turns can reference it.
  geminiHistory: { role: "user" | "model"; text: string }[] = [];
  geminiSessionId?: string;
  private geminiBuf = "";
  private geminiCurrent = "";
  /** True once we have already emitted a "message" event in this gemini turn. */
  private geminiEmitted = false;

  constructor(
    agentId: string,
    sessionId?: string,
    extraSystemPrompt?: string,
    mcpConfigJson?: string,
    provider: Provider = "claude",
    cwd?: string,
  ) {
    super();
    this.id = sessionId || uuid();
    this.agentId = agentId;
    this.extraSystemPrompt = extraSystemPrompt;
    this.mcpConfigJson = mcpConfigJson;
    this.provider = provider;
    this.cwd = cwd;
  }

  send(text: string): SendResult {
    this.lastActivityAt = Date.now(); // 使用者送出訊息，重置 idle 計時器
    console.log(`[AgentSession ${this.id.slice(0,8)}] send (${this.provider}, status=${this.status})`);
    // busy / starting（回合進行中）→ 排隊而非丟棄。回到 idle 時 drainQueue() 抽出送達。
    if (this.status === "busy" || this.status === "starting") {
      if (this.queue.length >= AgentSession.MAX_QUEUE) {
        this.lastTurnId = undefined; // 未排入 → 無對應回合
        this.emit("event", { type: "error", payload: `送信佇列已滿（>${AgentSession.MAX_QUEUE}），本則訊息未排入` });
        return "rejected";
      }
      const turnId = this.nextTurnId++;
      this.lastTurnId = turnId;
      // turnId 跟著這則 queued 訊息一起存，drainQueue 取出時設為當前回合 turnId。
      this.queue.push({ text, turnId });
      console.log(`[AgentSession ${this.id.slice(0,8)}] busy → 排隊（queue=${this.queue.length}, turn=${turnId}）`);
      return "queued";
    }
    const turnId = this.nextTurnId++;
    this.lastTurnId = turnId;
    this.dispatch(text, turnId);
    return "sent";
  }

  /** 實際把一則訊息送給對應 provider（不做 busy 判斷；呼叫端已確保可送）。
   *  設定 currentTurnId，讓本回合後續 emit 的 delta/message/result 都帶這個 turnId。 */
  private dispatch(text: string, turnId: number): void {
    this.currentTurnId = turnId;
    if (this.provider === "claude") {
      if (!this.child) this.spawnClaudeChild();
      this.writeClaudeMessage(text);
      this.setStatus("busy");
    } else if (this.provider === "codex") {
      this.spawnCodexTurnNow(text);
    } else {
      this.spawnGeminiTurnNow(text);
    }
  }

  /**
   * 回到 idle 時抽一則佇列訊息送出（觸發下一回合）。一次只抽一則——送出後 status
   * 轉回 busy，剩餘的等下一次回到 idle 再抽，天然序列化、依序送達，不會併發灌爆子程序。
   */
  private drainQueue(): void {
    if (this.status !== "idle") return;
    const next = this.queue.shift();
    if (next === undefined) return;
    console.log(`[AgentSession ${this.id.slice(0,8)}] idle → 抽出佇列訊息送出（剩 ${this.queue.length}, turn=${next.turnId}）`);
    // 用 queued 時就配好的 turnId 當作這一回合的 turnId（等待端才認得出自己那則）。
    this.dispatch(next.text, next.turnId);
  }

  /** 供 agentManager 在 MCP 重生前搶救佇列用的唯讀視圖（只回文字，turnId 不外露）。
   *  呼叫端應自行 spread（[...s.queuedMessages]）取快照，stop() 之後原陣列即清空。 */
  get queuedMessages(): readonly string[] {
    return this.queue.map((q) => q.text);
  }

  stop(): void {
    if (this.child) {
      // 記錄即將被 kill 的 child，讓 close handler 知道這是刻意的（不誤報 "error"）
      this.stoppingChild = this.child;
      try { this.child.kill(); } catch {}
      this.child = undefined;
    }
    // 明確 teardown：清掉未送出的佇列，避免 closed 狀態下佇列永遠不會被抽乾而變死佇列。
    // （TTL 回收的 idle session 佇列為空；真正未送的訊息也不會殘留在記憶體。）
    if (this.queue.length) {
      console.warn(`[AgentSession ${this.id.slice(0,8)}] stop() 清掉 ${this.queue.length} 則未送佇列訊息`);
      this.queue = [];
    }
    this.cleanupPromptFile();
    this.setStatus("closed");
  }

  /** 把 extraSystemPrompt 寫到 session 專屬暫存檔，回傳檔案路徑。Idempotent。 */
  private ensurePromptFile(): string {
    if (this.promptFilePath && fs.existsSync(this.promptFilePath)) {
      return this.promptFilePath;
    }
    ensurePromptTmpDir();
    const p = path.join(PROMPT_TMP_DIR, `${this.id}.md`);
    fs.writeFileSync(p, this.extraSystemPrompt || "", { encoding: "utf8" });
    this.promptFilePath = p;
    return p;
  }

  /** session 結束時刪掉暫存檔。失敗不丟錯（避免吃掉真正的 error）。 */
  private cleanupPromptFile(): void {
    if (!this.promptFilePath) return;
    try { fs.unlinkSync(this.promptFilePath); } catch {}
    this.promptFilePath = undefined;
  }

  private setStatus(s: SessionStatus) {
    this.status = s;
    this.emit("event", { type: "status", payload: s });
    // 回到 idle 是唯一的抽佇列時機：涵蓋 claude(result 事件) 與 codex/gemini(child close)
    // 三種 backend 的回合結束路徑，確保「idle 時佇列一定會被抽乾」，無死佇列。
    if (s === "idle") this.drainQueue();
  }

  // ============== Claude backend ==============

  private spawnClaudeChild(opts?: SpawnOpts) {
    const args = [
      "-p",
      "--agent", this.agentId,
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      // bypassPermissions:在 -p 非互動模式下,acceptEdits 對 MCP 工具仍會
      // 跳 prompt,但沒人能點 → 全部自動 deny。dashboard 使用情境:
      //   - 使用者在 workspace 設定中明確 opt-in 啟用 MCP
      //   - shellward MCP 作為 baseline 守門人(攔危險命令 / 注入)
      //   - UI 上有 SecurityBadge 即時顯示是否被保護
      // 所以這裡放開所有工具,讓「使用者授權 → 工具可用」這條鏈接通。
      "--permission-mode", "bypassPermissions",
    ];
    // Claude CLI 2.1+ rule: --session-id and --resume are mutually exclusive
    // (unless --fork-session is set, which we don't want — that creates a
    // diverging branch). On first turn we seed the session with our own UUID;
    // after that Claude returns its canonical claudeSessionId which we use
    // for --resume from then on.
    if (this.claudeSessionId) {
      args.push("--resume", this.claudeSessionId);
    } else {
      args.push("--session-id", this.id);
    }
    if (this.extraSystemPrompt) {
      // 走暫存檔路徑而非直接塞 args，繞過 Windows 命令列 32767 字元上限
      args.push("--append-system-prompt-file", this.ensurePromptFile());
    }
    if (this.mcpConfigJson) {
      args.push("--mcp-config", this.mcpConfigJson);
    }
    // PreToolUse hook 注入：SHELLWARD_GATE=off 時 path=null（逃生開關，不注入）。
    // agentManager 偵測 MCP 變更 force-respawn 會重呼本函式，--settings 自動跟上。
    const guardSettingsPath = getGuardSettingsPath();
    if (guardSettingsPath) {
      args.push("--settings", guardSettingsPath);
    }

    this.setStatus("starting");
    const child = spawnClaude(args, {
      cwd: opts?.cwd || this.cwd || process.cwd(),
      env: sanitizedChildEnv(),
    });
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.handleClaudeStdout(chunk));
    child.stderr!.on("data", (chunk: string) => {
      this.emit("event", { type: "error", payload: String(chunk).trim() });
    });
    child.on("error", (err) => {
      this.emit("event", { type: "error", payload: `spawn error: ${err.message}` });
    });
    child.on("close", (code) => {
      // 若是 stop() 主動 kill，stoppingChild 會指向同一個 child。
      // stop() 已呼叫 setStatus("closed")，這裡不可再 emit "error" 覆蓋它。
      const wasDeliberate = (this.stoppingChild === child);
      if (wasDeliberate) this.stoppingChild = undefined;
      if (wasDeliberate) {
        this.child = undefined;
        this.cleanupPromptFile();
        return;
      }
      // 非主動停止（自然結束或真正 crash）→ 依 exit code 決定狀態。
      this.emit("event", { type: "status", payload: code === 0 ? "closed" : "error" });
      this.status = code === 0 ? "closed" : "error";
      this.child = undefined;
      this.cleanupPromptFile();
    });
    this.child = child;
  }

  private writeClaudeMessage(text: string) {
    if (!this.child || !this.child.stdin) return;
    const obj = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    };
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private handleClaudeStdout(chunk: string) {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        this.routeClaudeEvent(evt);
      } catch { /* skip */ }
    }
  }

  private routeClaudeEvent(evt: any) {
    if (evt.session_id && !this.claudeSessionId) {
      this.claudeSessionId = evt.session_id;
    }
    if (evt.type === "rate_limit_event") {
      this.emit("event", { type: "rate_limit", payload: evt });
      return;
    }
    if (evt.type === "stream_event" && evt.event?.type === "content_block_delta") {
      const d = evt.event.delta;
      if (d?.type === "text_delta" && d.text) {
        this.emit("event", { type: "delta", turnId: this.currentTurnId, payload: d.text });
      }
      return;
    }
    if (evt.type === "assistant" && Array.isArray(evt.message?.content)) {
      const blocks = evt.message.content;
      for (const b of blocks) {
        if (b.type === "tool_use") {
          this.emit("event", { type: "tool_call", payload: { toolUseId: b.id || "", name: b.name || "", input: b.input ?? {} } });
        }
      }
      const text = blocks
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (text) {
        this.emit("event", { type: "message", turnId: this.currentTurnId, payload: { role: "assistant", content: text } });
      }
      return;
    }
    if (evt.type === "user") {
      // Tool results from MCPs may contain images (e.g. playwright screenshots).
      // Pull them out and emit a "tool_image" event so the dashboard can save +
      // render them inline.
      const content = evt.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            // Existing image extraction (preserved).
            if (Array.isArray(block.content)) {
              for (const c of block.content) {
                if (c.type === "image" && c.source?.type === "base64" && c.source?.data) {
                  this.emit("event", {
                    type: "tool_image",
                    payload: {
                      base64: c.source.data,
                      mediaType: c.source.media_type || "image/png",
                      toolUseId: block.tool_use_id || "",
                    },
                  });
                }
              }
            }
            // Capture textual tool result for observability.
            let text = "";
            if (typeof block.content === "string") {
              text = block.content;
            } else if (Array.isArray(block.content)) {
              text = block.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");
            }
            this.emit("event", {
              type: "tool_result",
              payload: {
                toolUseId: block.tool_use_id || "",
                status: block.is_error ? "error" : "ok",
                text,
              },
            });
          }
        }
      }
      return;
    }
    if (evt.type === "result") {
      // result 帶剛結束那一回合的 turnId（等待端據此嚴格比對，只認自己那回合）。
      this.emit("event", { type: "result", turnId: this.currentTurnId, payload: evt });
      this.lastActivityAt = Date.now(); // 回合結束，重置 idle 計時器
      this.setStatus("idle");
      return;
    }
  }

  // ============== Codex backend ==============

  private spawnCodexTurnNow(userText: string) {
    this.setStatus("starting");
    this.codexBuf = "";
    this.codexCurrent = "";
    this.codexEmitted = false;

    // For first turn, prepend system prompt into the user message (codex
    // doesn't have an --append-system-prompt flag). On subsequent turns
    // we use `resume` and codex remembers the original instructions.
    let prompt = userText;
    if (!this.codexThreadId && this.extraSystemPrompt) {
      prompt = `<context>\n${this.extraSystemPrompt}\n</context>\n\n${userText}`;
    }

    const child = spawnCodexTurn({
      prompt,
      threadId: this.codexThreadId,
      cwd: this.cwd || process.cwd(),
      sandbox: "read-only",
    });
    this.child = child;

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");

    child.stdout!.on("data", (chunk: string) => this.handleCodexStdout(String(chunk)));
    child.stderr!.on("data", (chunk: string) => {
      // codex prints normal status to stderr (e.g. "Reading additional input
      // from stdin..."); only surface real errors
      const s = String(chunk).trim();
      if (s && /error|failed|unauthorized|timed?\s*out|rate.?limit|quota/i.test(s)) {
        this.emit("event", { type: "error", payload: s });
      }
    });
    child.on("error", (err) => {
      this.emit("event", { type: "error", payload: `codex spawn error: ${err.message}` });
      this.setStatus("error");
    });
    child.on("close", (code) => {
      // Only emit fallback message when no message was already emitted this
      // turn (pure-delta path). Avoids double-write when item.completed
      // already emitted the message inside routeCodexEvent.
      if (!this.codexEmitted && this.codexCurrent && this.codexCurrent.trim()) {
        this.emit("event", { type: "message", turnId: this.currentTurnId, payload: { role: "assistant", content: this.codexCurrent } });
      }
      // Emit synthetic result
      this.emit("event", { type: "result", turnId: this.currentTurnId, payload: { provider: "codex", exit: code } });
      this.setStatus("idle");
      this.child = undefined;
    });

    // codex reads the full prompt from stdin (handled inside spawnCodexTurn)
    this.setStatus("busy");
  }

  private handleCodexStdout(chunk: string) {
    this.codexBuf += chunk;
    const lines = this.codexBuf.split("\n");
    this.codexBuf = lines.pop() || "";
    for (const line of lines) {
      const evt = parseCodexLine(line);
      if (!evt) continue;
      this.routeCodexEvent(evt);
    }
  }

  private routeCodexEvent(evt: ReturnType<typeof parseCodexLine>) {
    if (!evt) return;
    if (evt.type === "thread_started" && evt.threadId) {
      this.codexThreadId = evt.threadId;
      return;
    }
    if (evt.type === "item" && evt.text) {
      // Treat agent_message items as the assistant response
      if (evt.itemType === "agent_message" || !evt.itemType) {
        this.codexCurrent = evt.text;
        // emit as one chunk (codex doesn't stream)
        this.emit("event", { type: "delta", turnId: this.currentTurnId, payload: evt.text });
        this.emit("event", { type: "message", turnId: this.currentTurnId, payload: { role: "assistant", content: evt.text } });
        this.codexEmitted = true;
      }
      return;
    }
    if (evt.type === "turn_completed") {
      return;
    }
    if (evt.type === "error") {
      this.emit("event", { type: "error", payload: evt.text || "codex error" });
    }
  }

  // ============== Gemini backend ==============

  private spawnGeminiTurnNow(userText: string) {
    this.setStatus("starting");
    this.geminiBuf = "";
    this.geminiCurrent = "";
    this.geminiEmitted = false;

    // For first turn, prepend system prompt as context
    let prompt = userText;
    if (this.geminiHistory.length === 0 && this.extraSystemPrompt) {
      prompt = `<system>\n${this.extraSystemPrompt}\n</system>\n\n${userText}`;
    }

    const child = spawnGeminiTurn({
      prompt,
      conversationHistory: this.geminiHistory,
      cwd: this.cwd || process.cwd(),
    });
    this.child = child;

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");

    child.stdout!.on("data", (chunk: string) => {
      const s = String(chunk);
      console.log(`[gemini ${this.id.slice(0,8)}] stdout: ${s.slice(0, 200).replace(/\n/g, " ")}`);
      this.handleGeminiStdout(s);
    });
    child.stderr!.on("data", (chunk: string) => {
      const s = String(chunk).trim();
      console.log(`[gemini ${this.id.slice(0,8)}] stderr: ${s.slice(0, 300).replace(/\n/g, " ")}`);
      if (s && /error|failed|unauthorized|rate.?limit|quota|forbid/i.test(s) &&
          !/Windows 10 detected|true color|Ripgrep is not available/i.test(s)) {
        this.emit("event", { type: "error", payload: s });
      }
    });
    child.on("error", (err) => {
      this.emit("event", { type: "error", payload: `gemini spawn error: ${err.message}` });
      this.setStatus("error");
    });
    child.on("close", (code) => {
      // Persist into history
      if (this.geminiCurrent) {
        this.geminiHistory.push({ role: "user", text: userText });
        this.geminiHistory.push({ role: "model", text: this.geminiCurrent });
        if (this.geminiHistory.length > 20) {
          this.geminiHistory = this.geminiHistory.slice(-20);
        }
      }
      this.emit("event", { type: "result", turnId: this.currentTurnId, payload: { provider: "gemini", exit: code } });
      this.setStatus("idle");
      this.child = undefined;
    });

    this.setStatus("busy");
  }

  private handleGeminiStdout(chunk: string) {
    this.geminiBuf += chunk;
    const lines = this.geminiBuf.split("\n");
    this.geminiBuf = lines.pop() || "";
    for (const line of lines) {
      const evt = parseGeminiLine(line);
      if (!evt) continue;
      this.routeGeminiEvent(evt);
    }
  }

  private routeGeminiEvent(evt: ReturnType<typeof parseGeminiLine>) {
    if (!evt) return;
    if (evt.type === "init" && evt.sessionId) {
      this.geminiSessionId = evt.sessionId;
      return;
    }
    if (evt.type === "message" && evt.role === "assistant" && evt.content) {
      // gemini-cli 0.40 sends `delta:true` messages with append-style chunks
      // (each event's content is the NEW piece to add, not cumulative).
      // Non-delta messages are full final replacements.
      if (evt.isDelta) {
        this.emit("event", { type: "delta", turnId: this.currentTurnId, payload: evt.content });
        this.geminiCurrent += evt.content;
      } else {
        this.geminiCurrent = evt.content;
        this.emit("event", { type: "message", turnId: this.currentTurnId, payload: { role: "assistant", content: evt.content } });
        this.geminiEmitted = true;
      }
      return;
    }
    if (evt.type === "result") {
      // Only emit fallback message when no full-message event was emitted this
      // turn (pure-delta path). Avoids double-write for non-delta turns.
      if (!this.geminiEmitted && this.geminiCurrent) {
        this.emit("event", { type: "message", turnId: this.currentTurnId, payload: { role: "assistant", content: this.geminiCurrent } });
      }
      return;
    }
    if (evt.type === "error") {
      this.emit("event", { type: "error", payload: evt.content || "gemini error" });
    }
  }
}

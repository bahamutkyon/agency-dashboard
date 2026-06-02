import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { spawnClaude } from "./claudeProcess.js";
import { spawnCodexTurn, parseCodexLine } from "./codexProcess.js";
import { spawnGeminiTurn, parseGeminiLine } from "./geminiProcess.js";

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

export interface SessionEvent {
  type: "delta" | "message" | "status" | "error" | "result";
  payload: any;
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

  // Claude-specific state
  claudeSessionId?: string;
  private child?: ChildProcess;
  private buf = "";
  /** Claude `--append-system-prompt-file` 用的暫存檔路徑（session 級，可重用）。 */
  private promptFilePath?: string;

  // Codex-specific state
  codexThreadId?: string;
  private codexBuf = "";
  private codexCurrent = "";

  // Gemini-specific state — we manage history ourselves since gemini-cli's
  // multi-turn support is patchy. Keep the running transcript so subsequent
  // turns can reference it.
  geminiHistory: { role: "user" | "model"; text: string }[] = [];
  geminiSessionId?: string;
  private geminiBuf = "";
  private geminiCurrent = "";

  constructor(
    agentId: string,
    sessionId?: string,
    extraSystemPrompt?: string,
    mcpConfigJson?: string,
    provider: Provider = "claude",
  ) {
    super();
    this.id = sessionId || uuid();
    this.agentId = agentId;
    this.extraSystemPrompt = extraSystemPrompt;
    this.mcpConfigJson = mcpConfigJson;
    this.provider = provider;
  }

  send(text: string): void {
    console.log(`[AgentSession ${this.id.slice(0,8)}] send (${this.provider}, status=${this.status})`);
    if (this.status === "busy") {
      this.emit("event", { type: "error", payload: "Session is busy" });
      return;
    }
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

  stop(): void {
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = undefined;
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

    this.setStatus("starting");
    const child = spawnClaude(args, {
      cwd: opts?.cwd || process.cwd(),
      env: process.env,
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
        this.emit("event", { type: "delta", payload: d.text });
      }
      return;
    }
    if (evt.type === "assistant" && evt.message?.content) {
      const text = evt.message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (text) {
        this.emit("event", { type: "message", payload: { role: "assistant", content: text } });
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
          if (block.type === "tool_result" && Array.isArray(block.content)) {
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
        }
      }
      return;
    }
    if (evt.type === "result") {
      this.emit("event", { type: "result", payload: evt });
      this.setStatus("idle");
      return;
    }
  }

  // ============== Codex backend ==============

  private spawnCodexTurnNow(userText: string) {
    this.setStatus("starting");
    this.codexBuf = "";
    this.codexCurrent = "";

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
      cwd: process.cwd(),
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
      // Emit any leftover assistant text not delivered as item.completed
      if (this.codexCurrent && this.codexCurrent.trim()) {
        this.emit("event", { type: "message", payload: { role: "assistant", content: this.codexCurrent } });
      }
      // Emit synthetic result
      this.emit("event", { type: "result", payload: { provider: "codex", exit: code } });
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
        this.emit("event", { type: "delta", payload: evt.text });
        this.emit("event", { type: "message", payload: { role: "assistant", content: evt.text } });
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

    // For first turn, prepend system prompt as context
    let prompt = userText;
    if (this.geminiHistory.length === 0 && this.extraSystemPrompt) {
      prompt = `<system>\n${this.extraSystemPrompt}\n</system>\n\n${userText}`;
    }

    const child = spawnGeminiTurn({
      prompt,
      conversationHistory: this.geminiHistory,
      cwd: process.cwd(),
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
      this.emit("event", { type: "result", payload: { provider: "gemini", exit: code } });
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
        this.emit("event", { type: "delta", payload: evt.content });
        this.geminiCurrent += evt.content;
      } else {
        this.geminiCurrent = evt.content;
        this.emit("event", { type: "message", payload: { role: "assistant", content: evt.content } });
      }
      return;
    }
    if (evt.type === "result") {
      // ensure we emit a final assistant message even if all chunks were deltas
      if (this.geminiCurrent) {
        this.emit("event", { type: "message", payload: { role: "assistant", content: this.geminiCurrent } });
      }
      return;
    }
    if (evt.type === "error") {
      this.emit("event", { type: "error", payload: evt.content || "gemini error" });
    }
  }
}

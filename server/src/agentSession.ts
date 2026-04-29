import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { v4 as uuid } from "uuid";
import { spawnClaude } from "./claudeProcess.js";
import { spawnCodexTurn, parseCodexLine } from "./codexProcess.js";
import { spawnGeminiTurn } from "./geminiProcess.js";

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
  readonly mcpConfigJson?: string;
  status: SessionStatus = "idle";

  // Claude-specific state
  claudeSessionId?: string;
  private child?: ChildProcess;
  private buf = "";

  // Codex-specific state
  codexThreadId?: string;
  private codexBuf = "";
  private codexCurrent = "";

  // Gemini-specific state — we manage history ourselves since gemini-cli's
  // multi-turn support is patchy. Keep the running transcript so subsequent
  // turns can reference it.
  geminiHistory: { role: "user" | "model"; text: string }[] = [];
  private geminiBuf = "";

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
    this.setStatus("closed");
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
      "--permission-mode", "acceptEdits",
      "--session-id", this.id,
    ];
    if (this.extraSystemPrompt) {
      args.push("--append-system-prompt", this.extraSystemPrompt);
    }
    if (this.mcpConfigJson) {
      args.push("--mcp-config", this.mcpConfigJson);
    }
    if (this.claudeSessionId) {
      args.push("--resume", this.claudeSessionId);
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
    if (evt.type === "user") return;
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

    // For first turn, prepend system prompt
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

    let collected = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      const s = String(chunk);
      collected += s;
      // Emit as deltas as they arrive — gemini-cli streams text by default
      this.emit("event", { type: "delta", payload: s });
    });
    child.stderr!.on("data", (chunk: string) => {
      const s = String(chunk).trim();
      if (s && /error|failed|unauthorized|rate.?limit|quota|forbid/i.test(s)) {
        this.emit("event", { type: "error", payload: s });
      }
    });
    child.on("error", (err) => {
      this.emit("event", { type: "error", payload: `gemini spawn error: ${err.message}` });
      this.setStatus("error");
    });
    child.on("close", (code) => {
      const final = collected.trim();
      // Try to strip CLI banner / status lines if any (heuristic: if the
      // response looks like JSON wrapper, extract; else treat as plain text)
      let answer = final;
      try {
        const j = JSON.parse(final);
        answer = j.text || j.response || j.content || final;
      } catch { /* plain text — use as-is */ }

      if (answer) {
        this.emit("event", { type: "message", payload: { role: "assistant", content: answer } });
        // Update local history for next turn
        this.geminiHistory.push({ role: "user", text: userText });
        this.geminiHistory.push({ role: "model", text: answer });
        // Cap history to last 20 messages
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
}
